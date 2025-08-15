"use strict";

import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;

import IVisualHost = powerbi.extensibility.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

import DataView = powerbi.DataView;
import DataViewCategorical = powerbi.DataViewCategorical;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;

import { VisualSettings } from "./settings";

interface Item {
  label: string;
  selectionId: ISelectionId;
  selected: boolean;
}

export class Visual implements IVisual {
  private host!: IVisualHost;
  private selectionManager!: ISelectionManager;

  private root!: HTMLElement;
  private listContainer!: HTMLElement;
  private list!: HTMLElement;

  private settings: VisualSettings = new VisualSettings();
  private items: Item[] = [];

  // sync / anti-loop
  private suppressNextSelectCallback = false;
  private didInitialForce = false;

  // para heurísticas de “forçar 1ª” e detectar re-expansão
  private lastItemCount = 0;

  // detectar troca/remoção do campo
  private lastCategoryQueryName: string | null = null;

  constructor(options?: VisualConstructorOptions) {
    // DOM base
    this.root = document.createElement("div");
    this.root.className = "filtro-conjugado";

    this.listContainer = document.createElement("div");
    this.listContainer.className = "list-container";

    this.list = document.createElement("ul");
    this.list.className = "list";

    this.listContainer.appendChild(this.list);
    this.root.appendChild(this.listContainer);

    // placeholders
    this.host = ({ persistProperties: () => {} } as any);
    this.selectionManager = ({
      select: () => Promise.resolve([]),
      clear: () => Promise.resolve(),
      registerOnSelectCallback: () => {}
    } as any);

    if (options) {
      this.host = options.host as IVisualHost;
      this.selectionManager = (this.host as any).createSelectionManager
        ? (this.host as any).createSelectionManager()
        : this.selectionManager;

      options.element.appendChild(this.root);

      // seleção desta visual (não recebe seleção de OUTRAS visuais)
      this.selectionManager.registerOnSelectCallback((_ids: any) => {
        if (this.suppressNextSelectCallback) {
          this.suppressNextSelectCallback = false;
          return;
        }
        // Apenas re-renderiza classes, os items já refletem o estado local
        this.updateListSelectionClasses();
      });
    }
  }

  public update(options: VisualUpdateOptions): void {
    const dv = options.dataViews && options.dataViews[0];
    if (dv) this.settings = VisualSettings.parse(dv);

    const cat = dv?.categorical?.categories?.[0] || null;
    const qn = cat?.source?.queryName || null;

    // REMOÇÃO DO CAMPO: zera tudo e limpa seleção
    if (!cat) {
      this.items = [];
      this.didInitialForce = false;
      this.lastItemCount = 0;
      this.lastCategoryQueryName = null;

      this.suppressNextSelectCallback = true;
      this.selectionManager.clear();

      this.render();
      return;
    }

    // TROCA DE CAMPO: reseta estado interno
    if (this.lastCategoryQueryName && qn && qn !== this.lastCategoryQueryName) {
      this.items = [];
      this.didInitialForce = false;
      this.lastItemCount = 0;
    }
    this.lastCategoryQueryName = qn;

    // Reconstrói SEM “locks”: sempre aceita o que o modelo mandar
    const r = this.rebuildItems(dv, cat);

    // Host tem seleção ATIVA para este visual?
    const smAny = this.selectionManager as any;
    const hostHasSelection =
      typeof smAny.hasSelection === "function" ? !!smAny.hasSelection() : false;

    // Forçar 1ª seleção (modo único) – só quando:
    // - single + force ligado
    // - há itens
    // - ainda não forçamos nesta rodada
    // - NÃO há seleção no host para esta visual
    // - a lista ENCOLHEU (contagem atual <= contagem anterior) ou é a 1ª vez (lastItemCount === 0)
    const isSingle = this.settings.behavior_selectionMode; // true = único
    const canForceBase =
      isSingle && this.settings.behavior_forceSelection && this.items.length > 0;
    const justShrunk = this.lastItemCount === 0 || r.count <= this.lastItemCount;

    if (canForceBase && !hostHasSelection && !this.didInitialForce && justShrunk) {
      // só força se o 1º item ainda não está marcado localmente
      let needForce = true;
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].selected) { needForce = false; break; }
      }
      if (needForce) {
        // marca localmente
        for (let i = 0; i < this.items.length; i++) this.items[i].selected = false;
        this.items[0].selected = true;

        // dispara seleção (sem loop)
        this.suppressNextSelectCallback = true;
        this.selectionManager.select(this.items[0].selectionId, false);

        this.didInitialForce = true;
      }
    }

    // Atualiza “baseline” de contagem (p/ heurística)
    this.lastItemCount = r.count;

    this.render();
  }

  // ======== Data ========

  private rebuildItems(dv: DataView, cat: DataViewCategoryColumn): { changed: boolean; count: number } {
    const categorical = dv.categorical as DataViewCategorical;
    if (!categorical || !cat) return { changed: false, count: 0 };

    const values = cat.values || [];
    const newCount = values.length;

    const newItems: Item[] = new Array(newCount);
    for (let i = 0; i < newCount; i++) {
      const v = values[i];
      const selectionId = (this.host as any)
        .createSelectionIdBuilder()
        .withCategory(cat, i)
        .createSelectionId() as ISelectionId;

      newItems[i] = {
        label: v == null ? "" : String(v),
        selectionId,
        selected: false
      };
    }

    // Mantém seleção anterior por label (best-effort) se possível
    if (this.items.length > 0) {
      const prevSelected = new Set<string>();
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].selected) prevSelected.add(this.items[i].label);
      }
      if (prevSelected.size > 0) {
        for (let i = 0; i < newItems.length; i++) {
          if (prevSelected.has(newItems[i].label)) newItems[i].selected = true;
        }
      }
    }

    // Detecta mudança
    let changed = newItems.length !== this.items.length;
    if (!changed) {
      for (let i = 0; i < newItems.length; i++) {
        if (this.items[i]?.label !== newItems[i].label) { changed = true; break; }
      }
    }

    if (changed) this.items = newItems;
    return { changed, count: newCount };
  }

  // ======== Render ========

  private render(): void {
    while (this.list.firstChild) this.list.removeChild(this.list.firstChild);

    if (this.items.length === 0) {
      const el = document.createElement("div");
      el.className = "empty";
      el.textContent = "Sem itens";
      this.list.appendChild(el);
      return;
    }

    const isSingle = this.settings.behavior_selectionMode; // true = radio, false = checkbox

    for (let idx = 0; idx < this.items.length; idx++) {
      const item = this.items[idx];

      const li = document.createElement("li");
      li.className = "item" + (item.selected ? " selected" : "");
      li.style.fontSize = `${this.settings.formatting_fontSize}px`;
      li.style.paddingTop = `${this.settings.formatting_itemPadding}px`;
      li.style.paddingBottom = `${this.settings.formatting_itemPadding}px`;

      // Input explícito (radio / checkbox)
      const input = document.createElement("input");
      input.type = isSingle ? "radio" : "checkbox";
      if (isSingle) input.name = "visual-selection-group";
      input.checked = item.selected;

      input.addEventListener("click", (ev) => {
        ev.stopPropagation(); // evita duplo disparo
        this.onItemClick(item, !isSingle && (ev as MouseEvent).ctrlKey);
      });

      const label = document.createElement("span");
      label.textContent = item.label;
      label.style.marginLeft = "4px";
      label.style.wordBreak = "break-word";

      li.appendChild(input);
      li.appendChild(label);

      // clique na linha inteira também seleciona
      li.addEventListener("mousedown", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        ev.preventDefault();
      });
      li.addEventListener("click", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        this.onItemClick(item, !isSingle && (ev as MouseEvent).ctrlKey);
      });

      this.list.appendChild(li);
    }
  }

  private onItemClick(item: Item, userMultiKey: boolean): void {
    const isSingle = this.settings.behavior_selectionMode;
    const isMultiMode = !isSingle;

    // Evita toggle-off no modo único + forçar: clicar no mesmo não limpa
    if (isSingle && this.settings.behavior_forceSelection && item.selected) {
      return;
    }

    if (isMultiMode) {
      item.selected = !item.selected;
    } else {
      for (let i = 0; i < this.items.length; i++) this.items[i].selected = false;
      item.selected = true;
    }

    this.updateListSelectionClasses();

    // Marca que já “forçamos” nesta rodada, para não re-forçar em update()
    this.didInitialForce = true;

    // dispara seleção (sem loop)
    this.suppressNextSelectCallback = true;

    if (isMultiMode) {
      const selectedIds: ISelectionId[] = [];
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].selected) selectedIds.push(this.items[i].selectionId);
      }
      if (selectedIds.length > 0) {
        this.selectionManager.select(selectedIds as any, true);
      } else {
        this.selectionManager.clear();
      }
    } else {
      this.selectionManager.select(item.selectionId, false);
    }
  }

  private updateListSelectionClasses(): void {
    const children = Array.prototype.slice.call(this.list.children) as HTMLElement[];
    for (let i = 0; i < children.length; i++) {
      const el = children[i] as HTMLElement;
      if (!el.classList.contains("item")) continue;
      const it = this.items[i];
      if (!it) continue;

      el.classList.toggle("selected", !!it.selected);
      const input = el.querySelector("input") as HTMLInputElement;
      if (input) input.checked = !!it.selected;
    }
  }

  // ======== Painel ========

  public enumerateObjectInstances(
    options: powerbi.EnumerateVisualObjectInstancesOptions
  ): powerbi.VisualObjectInstanceEnumeration {

    const instances: powerbi.VisualObjectInstance[] = [];

    if (options.objectName === "behavior") {
      instances.push({
        objectName: "behavior",
        properties: {
          selectionMode: this.settings.behavior_selectionMode, // true = único (radio)
          forceSelection: this.settings.behavior_forceSelection
        },
        selector: {} as any
      } as any);
    }

    if (options.objectName === "formatting") {
      instances.push({
        objectName: "formatting",
        properties: {
          fontSize: this.settings.formatting_fontSize,
          itemPadding: this.settings.formatting_itemPadding
        },
        selector: {} as any
      } as any);
    }

    return instances;
  }
}

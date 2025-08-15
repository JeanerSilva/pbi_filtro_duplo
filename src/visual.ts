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

import { VisualSettings } from "./settings";

interface Item {
  label: string;
  selectionId: ISelectionId;
  selected: boolean;
}

export class Visual implements IVisual {

  private lastCategoryQueryName: string | null = null;

  private host!: IVisualHost;
  private selectionManager!: ISelectionManager;

  private root!: HTMLElement;
  private listContainer!: HTMLElement;
  private list!: HTMLElement;

  private settings: VisualSettings = new VisualSettings();
  private items: Item[] = [];

  // anti-loop / sincronização
  private suppressNextSelectCallback = false;
  private externalKeys = new Set<string>(); // seleção que o host informou (para ESTE visual)
  private didInitialForce = false;          // evita forçar repetidamente
  private itemsSignature = "";              // identifica mudança real dos dados

  // ---- Controle de “rebote” de dados / travar domínio filtrado ----
  private maxItemCount = 0;       // maior cardinalidade já vista (domínio “completo”)
  private lastItemCount = 0;
  private filteredLock = false;   // se true, ignoramos aumentos de cardinalidade
  // ------------------------------------------------------------------

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

      // callback de seleção (de OUTRAS visuais OU desta)
      this.selectionManager.registerOnSelectCallback((ids: any) => {
        if (this.suppressNextSelectCallback) {
          this.suppressNextSelectCallback = false;
          return;
        }
        const visualIds = (ids || []) as unknown as ISelectionId[];
        this.applyExternalSelection(visualIds);
      });
    }
  }

  public update(options: VisualUpdateOptions): void {
    const dataView = options.dataViews && options.dataViews[0];

    // settings vêm de metadata.objects — atualize mesmo sem dados
    if (dataView) this.settings = VisualSettings.parse(dataView);

    const dv = options.dataViews && options.dataViews[0];
    const cat = dv?.categorical?.categories?.[0] || null;
    const qn = cat?.source?.queryName || null;

    // 0) Sempre parse settings se dv existir
    if (dv) this.settings = VisualSettings.parse(dv);

    // A) Campo REMOVIDO: sem categoria => limpa lista e destrava tudo
    if (!cat) {
      this.items = [];
      this.itemsSignature = "";
      this.externalKeys.clear();
      this.didInitialForce = false;
      this.filteredLock = false;
      this.maxItemCount = 0;
      this.lastItemCount = 0;
      this.lastCategoryQueryName = null;
      this.render();
      return; // nada mais a fazer neste update
    }

    // B) Campo TROCOU (queryName diferente): reset controlado
    if (this.lastCategoryQueryName && qn && qn !== this.lastCategoryQueryName) {
      this.items = [];
      this.itemsSignature = "";
      this.externalKeys.clear();
      this.didInitialForce = false;
      this.filteredLock = false;
      this.maxItemCount = 0;
      this.lastItemCount = 0;
    }
    // atualiza cache do campo
    this.lastCategoryQueryName = qn;


    // 1) Transformar dados SOMENTE se houver categorias
    let rebuildResult: { changed: boolean; count: number } | null = null;
    if (dataView && this.hasDataViewCategories(dataView)) {
      rebuildResult = this.rebuildItemsWithLock(dataView);
      if (rebuildResult.changed) {
        const sig = this.items.map(i => i.label).join("|");
        if (sig !== this.itemsSignature) {
          this.itemsSignature = sig;
          this.didInitialForce = false; // nova “rodada” de dados
        }
      }
    }

    // 2) Determinar se o host já tem alguma seleção ativa
    const smAny = this.selectionManager as any;
    const hostHasSelection = typeof smAny.hasSelection === "function"
      ? !!smAny.hasSelection()
      : (this.externalKeys.size > 0);

    // 3) Atualizar lock conforme cardinalidade vs domínio completo
    //    - Se count < maxItemCount => estamos filtrados -> liga lock
    //    - Se count == maxItemCount e NÃO há seleção no host e ninguém selecionado localmente -> desliga lock
    if (rebuildResult) {
      const count = rebuildResult.count;
      if (this.maxItemCount < count) this.maxItemCount = count; // aprende domínio completo

      const anyLocalSelected = this.items.some(i => i.selected);

      if (count > 0 && this.maxItemCount > 0) {
        if (count < this.maxItemCount) {
          this.filteredLock = true; // estamos sob filtro externo (ex.: Estado selecionado)
        } else if (count === this.maxItemCount && !hostHasSelection && !anyLocalSelected) {
          this.filteredLock = false; // desbloqueia quando realmente não há filtro nenhum
        }
      }
      this.lastItemCount = count;
    }

    // 4) Forçar seleção (modo único) — apenas quando seguro
    const isSingle = this.settings.behavior_selectionMode; // true = seleção única
    const canForceBase = isSingle && this.settings.behavior_forceSelection && this.items.length > 0;

    // Só força se:
    //  - canForceBase
    //  - não há seleção deste visual no host (externalKeys desconhecidas) E (opcional: hasSelection=false)
    //  - ainda não forçamos nesta rodada
    //  - (IMPORTANTE) estamos LOCKADOS (lista já foi reduzida por filtro externo) OU é a 1ª render com domínio completo
    const safeToForce =
      canForceBase &&
      !hostHasSelection &&
      !this.didInitialForce &&
      (this.filteredLock || this.maxItemCount === this.items.length);

    if (safeToForce) {
      // força somente se o primeiro não estiver implicitamente selecionado
      const k0 = (this.items[0].selectionId as any).getKey?.();
      if (!this.externalKeys.has(k0)) {
        for (const it of this.items) it.selected = false;
        this.items[0].selected = true;

        this.suppressNextSelectCallback = true;
        this.selectionManager.select(this.items[0].selectionId, false);
      }
      this.didInitialForce = true;
    }

    // 5) Render
    this.render();
  }

  // ======== Data helpers ========

  private hasDataViewCategories(dv: DataView): boolean {
    const cat = dv?.categorical?.categories?.[0];
    const len = cat?.values?.length ?? 0;
    return !!cat && len > 0;
  }

  /**
   * Reconstrói items respeitando um "lock" de domínio filtrado:
   * - Aceita sempre reduções (count diminui ou igual)
   * - Rejeita aumentos (count cresce) enquanto filteredLock estiver ativo
   * Retorna {changed, count}.
   */
  private rebuildItemsWithLock(dataView: DataView): { changed: boolean; count: number } {
    const categorical = dataView.categorical as DataViewCategorical;
    const cat = categorical?.categories?.[0];
    const values = cat?.values || [];
    const newCount = values.length;

    if (!cat || newCount === 0) return { changed: false, count: 0 };

    // Se estamos lockados e houve AUMENTO de cardinalidade, ignore este update (rebote)
    if (this.filteredLock && newCount > this.lastItemCount) {
      return { changed: false, count: this.lastItemCount };
    }

    // Constrói nova lista
    const newItems: Item[] = [];
    for (let i = 0; i < newCount; i++) {
      const v = values[i];
      const selectionId = (this.host as any)
        .createSelectionIdBuilder()
        .withCategory(cat, i)
        .createSelectionId() as ISelectionId;

      newItems.push({
        label: (v == null ? "" : String(v)),
        selectionId,
        selected: false
      });
    }

    const changed =
      newItems.length !== this.items.length ||
      newItems.some((ni, idx) => this.items[idx]?.label !== ni.label);

    if (changed) this.items = newItems;

    return { changed, count: newCount };
  }

  // ======== Render ========

  private render(): void {
    // limpa UL
    while (this.list.firstChild) this.list.removeChild(this.list.firstChild);

    if (this.items.length === 0) {
      const el = document.createElement("div");
      el.className = "empty";
      el.textContent = "Sem itens";
      this.list.appendChild(el);
      return;
    }

    for (const item of this.items) {
      const li = document.createElement("li");
      li.className = "item" + (item.selected ? " selected" : "");
      li.textContent = item.label;

      // formatação
      li.style.fontSize = `${this.settings.formatting_fontSize}px`;
      li.style.paddingTop = `${this.settings.formatting_itemPadding}px`;
      li.style.paddingBottom = `${this.settings.formatting_itemPadding}px`;

      li.addEventListener("mousedown", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        ev.preventDefault();
      });

      li.addEventListener("click", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        const userMultiKey = (ev as MouseEvent).ctrlKey || (ev as MouseEvent).metaKey;
        this.onItemClick(item, userMultiKey);
      });

      this.list.appendChild(li);
    }
  }

  private onItemClick(item: Item, userMultiKey: boolean): void {
    const isMultiMode = !this.settings.behavior_selectionMode; // false => múltipla

    // Evita limpar seleção ao clicar de novo no mesmo item (toggle off do host)
    const singleMode = this.settings.behavior_selectionMode; // true = único
    if (singleMode && this.settings.behavior_forceSelection && item.selected) {
      // Mantém exatamente como está; não dispara select nem altera nada
      return;
    }
    const multiGesture = isMultiMode ? (userMultiKey || false) : false;

    if (isMultiMode) {
      item.selected = !item.selected;
    } else {
      for (const it of this.items) it.selected = false;
      item.selected = true;
    }

    this.updateListSelectionClasses();

    // Ao clicar, esta instância é quem “manda” — travamos no domínio atual
    this.filteredLock = true;
    this.didInitialForce = true;
    this.suppressNextSelectCallback = true;

    if (isMultiMode) {
      const selectedIds = this.items.filter(i => i.selected).map(i => i.selectionId);
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
    }
  }

  // ======== Sincronização externa ========

  private applyExternalSelection(ids: ISelectionId[]): void {
    // guarda chaves do host (para ESTE visual)
    const keys = new Set((ids || []).map((id: any) => id.getKey?.()));
    this.externalKeys = keys;

    // se não temos itens agora (ex.: update de formatação), não há o que refletir
    if (this.items.length === 0) return;

    let changed = false;

    if (!ids || ids.length === 0) {
      // sem seleção do host: na próxima atualização com dados “completos”, soltamos o lock
      // aqui apenas limpamos seleção local
      for (const it of this.items) {
        if (it.selected) { it.selected = false; changed = true; }
      }
    } else {
      // refletir seleção externa deste visual
      for (const it of this.items) {
        const sel = keys.has((it.selectionId as any).getKey?.());
        if (it.selected !== sel) { it.selected = sel; changed = true; }
      }
      // se recebemos seleção externa com a lista reduzida, mantenha o lock
      if (this.items.length < this.maxItemCount) {
        this.filteredLock = true;
      }
    }

    if (changed) this.updateListSelectionClasses();
  }

  // ======== Painel de formatação ========

  public enumerateObjectInstances(
    options: powerbi.EnumerateVisualObjectInstancesOptions
  ): powerbi.VisualObjectInstanceEnumeration {

    const instances: powerbi.VisualObjectInstance[] = [];

    if (options.objectName === "behavior") {
      instances.push({
        objectName: "behavior",
        properties: {
          selectionMode: this.settings.behavior_selectionMode,
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

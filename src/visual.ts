"use strict";

import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.IVisualHost;

import DataView = powerbi.DataView;
import DataViewCategorical = powerbi.DataViewCategorical;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;

import { VisualSettings } from "./settings";

interface Item {
  label: string;
  selected: boolean;
}

type BasicFilterTarget = { table: string; column: string } | null;

const FILTER_OBJECT = "general";
const FILTER_PROP = "filter";

// Power BI BasicFilter (schema simplificado)
interface BasicFilter {
  $schema: string; // "http://powerbi.com/product/schema#basic"
  target: { table: string; column: string };
  operator: "In" | "NotIn";
  values: any[]; // string[] normalmente
  filterType: number; // 1 = Basic
}

export class Visual implements IVisual {
  private host!: IVisualHost;

  private root!: HTMLElement;
  private listContainer!: HTMLElement;
  private list!: HTMLElement;

  private settings: VisualSettings = new VisualSettings();
  private items: Item[] = [];

  // guarda target do campo categórico para aplicar filtro
  private currentTarget: BasicFilterTarget = null;
  private lastCategoryQueryName: string | null = null;

  // heurística p/ forçar 1ª seleção
  private lastItemCount = 0;

  constructor(options?: VisualConstructorOptions) {
    // DOM
    this.root = document.createElement("div");
    this.root.className = "filtro-conjugado";

    this.listContainer = document.createElement("div");
    this.listContainer.className = "list-container";

    this.list = document.createElement("ul");
    this.list.className = "list";

    this.listContainer.appendChild(this.list);
    this.root.appendChild(this.listContainer);

    // host placeholder
    this.host = ({ applyJsonFilter: () => {} } as any);

    if (options) {
      this.host = options.host as IVisualHost;
      options.element.appendChild(this.root);
    }
  }

  public update(options: VisualUpdateOptions): void {
    const dv = options.dataViews && options.dataViews[0];

    if (dv) this.settings = VisualSettings.parse(dv);

    const categorical = dv?.categorical as DataViewCategorical;
    const cat = categorical?.categories && categorical.categories[0] || null;

    // Campo removido → zera estado e NÃO aplica/limpa filtro automaticamente
    if (!cat) {
      this.items = [];
      this.currentTarget = null;
      this.lastCategoryQueryName = null;
      this.lastItemCount = 0;
      this.render();
      return;
    }

    // Troca de campo → reseta
    const qn = (cat.source && cat.source.queryName) || null;
    if (this.lastCategoryQueryName && qn && qn !== this.lastCategoryQueryName) {
      this.items = [];
      this.lastItemCount = 0;
    }
    this.lastCategoryQueryName = qn;

    // Descobre/guarda o target {table, column} do campo
    this.currentTarget = this.extractTargetFromMetadata(cat);

    // Reconstrói itens conforme DataView atual (já vem afetado pelos filtros da página)
    this.rebuildItems(cat);

    // Forçar 1ª seleção em modo único se habilitado e seguro
    const isSingle = this.settings.behavior_selectionMode; // true = único
    const canForce = isSingle && this.settings.behavior_forceSelection && this.items.length > 0;

    // só se não tem nada marcado E lista encolheu (ou primeira vez)
    if (canForce) {
      let anySel = false;
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].selected) { anySel = true; break; }
      }
      const justShrunk = this.lastItemCount === 0 || this.items.length <= this.lastItemCount;

      if (!anySel && justShrunk) {
        for (let i = 0; i < this.items.length; i++) this.items[i].selected = false;
        this.items[0].selected = true;
        this.applyBasicFilter(); // aplica filtro no próprio campo
      }
    }

    this.lastItemCount = this.items.length;

    this.render();
  }

  // ----------------- Data helpers -----------------

  private rebuildItems(cat: DataViewCategoryColumn): void {
    const values = cat.values || [];
    const newItems: Item[] = new Array(values.length);

    // preserva seleção anterior por label (best-effort)
    const prevSel = new Set<string>();
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].selected) prevSel.add(this.items[i].label);
    }

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const label = v == null ? "" : String(v);
      newItems[i] = { label, selected: prevSel.has(label) };
    }

    this.items = newItems;
  }

  // Extrai {table, column} de formas comuns no metadata da categoria
  private extractTargetFromMetadata(cat: DataViewCategoryColumn): BasicFilterTarget {
    // 1) expr (mais robusto)
    const expr: any = (cat.source as any)?.expr;
    try {
      const col =
        (expr && (expr.ref || expr.level || (expr.source && expr.source.ref))) ||
        (cat.source as any)?.groupName; // fallback raro

      const tbl =
        (expr && expr.source && expr.source.entity) ||
        (expr && expr.arg && expr.arg.source && expr.arg.source.entity) ||
        (expr && expr.arg && expr.arg.arg && expr.arg.arg.entity);

      if (tbl && col) return { table: String(tbl), column: String(col) };
    } catch (_) { /* ignore */ }

    // 2) queryName muito comum: "Tabela.Coluna"
    const qn = cat.source?.queryName;
    if (qn && typeof qn === "string") {
      const dot = qn.lastIndexOf(".");
      if (dot > 0 && dot < qn.length - 1) {
        return { table: qn.substring(0, dot), column: qn.substring(dot + 1) };
      }
    }

    // 3) displayName (último recurso – pode não bater com o nome real)
    if (cat.source?.displayName) {
      return { table: "", column: cat.source.displayName };
    }

    return null;
    }

  // ----------------- Filtro JSON (Basic) -----------------

  private applyBasicFilter(): void {
    if (!this.currentTarget) return;

    // Coleta labels selecionados
    const selected: string[] = [];
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].selected) selected.push(this.items[i].label);
    }

    // Se nada selecionado, remove o filtro deste visual
    if (selected.length === 0) {
      (this.host as any).applyJsonFilter(null, FILTER_OBJECT, FILTER_PROP, 2 /* Remove */);
      return;
    }

    const bf: BasicFilter = {
      $schema: "http://powerbi.com/product/schema#basic",
      filterType: 1,
      target: { table: this.currentTarget.table, column: this.currentTarget.column },
      operator: "In",
      values: selected
    };

    // 0 = Merge → combina com outros filtros (ex.: Estado)
    (this.host as any).applyJsonFilter(bf, FILTER_OBJECT, FILTER_PROP, 0 /* Merge */);
  }

  // ----------------- Render -----------------

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

      const input = document.createElement("input");
      input.type = isSingle ? "radio" : "checkbox";
      if (isSingle) input.name = "visual-selection-group";
      input.checked = item.selected;

      input.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onItemClick(item);
      });

      const label = document.createElement("span");
      label.textContent = item.label;
      label.style.marginLeft = "4px";
      label.style.wordBreak = "break-word";

      li.appendChild(input);
      li.appendChild(label);

      li.addEventListener("mousedown", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        ev.preventDefault();
      });
      li.addEventListener("click", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        this.onItemClick(item);
      });

      this.list.appendChild(li);
    }
  }

  private onItemClick(item: Item): void {
    const isSingle = this.settings.behavior_selectionMode;
    const isMulti = !isSingle;

    // Evita "toggle off" no modo único + forçar seleção
    if (isSingle && this.settings.behavior_forceSelection && item.selected) {
      return;
    }

    if (isMulti) {
      item.selected = !item.selected;
    } else {
      for (let i = 0; i < this.items.length; i++) this.items[i].selected = false;
      item.selected = true;
    }

    // Sincroniza UI
    this.updateListSelectionClasses();

    // Aplica JSON filter (AND com outros visuais)
    this.applyBasicFilter();
  }

  private updateListSelectionClasses(): void {
    const children = (Array.prototype.slice.call(this.list.children) as HTMLElement[]);
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

  // ----------------- Pane de Formatação -----------------

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

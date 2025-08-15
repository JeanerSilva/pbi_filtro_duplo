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

interface BasicFilter {
  $schema: string;
  target: { table: string; column: string };
  operator: "In" | "NotIn";
  values: any[];
  filterType: number; // 1
}

export class Visual implements IVisual {
  private host!: IVisualHost;

  private root!: HTMLElement;
  private searchBar!: HTMLElement;
  private searchInputWrap!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchClear!: HTMLElement;

  private listContainer!: HTMLElement;
  private list!: HTMLElement;

  private settings: VisualSettings = new VisualSettings();
  private items: Item[] = [];

  // busca (estado local)
  private searchQuery: string = "";

  // filtro JSON
  private currentTarget: BasicFilterTarget = null;
  private lastCategoryQueryName: string | null = null;
  private lastItemCount = 0;

  constructor(options?: VisualConstructorOptions) {
    // root
    this.root = document.createElement("div");
    this.root.className = "filtro-conjugado";

    // search bar
    this.searchBar = document.createElement("div");
    this.searchBar.className = "search-bar";

    this.searchInputWrap = document.createElement("div");
    this.searchInputWrap.className = "search-input-wrap";

    this.searchInput = document.createElement("input");
    this.searchInput.className = "search-input";
    this.searchInput.type = "text";
    this.searchInput.placeholder = "Pesquisar...";

    this.searchClear = document.createElement("div");
    this.searchClear.className = "search-clear";
    this.searchClear.textContent = "X";
    this.searchClear.title = "Limpar";

    this.searchInputWrap.appendChild(this.searchInput);
    this.searchInputWrap.appendChild(this.searchClear);
    this.searchBar.appendChild(this.searchInputWrap);

    // lista
    this.listContainer = document.createElement("div");
    this.listContainer.className = "list-container";

    this.list = document.createElement("ul");
    this.list.className = "list";

    this.listContainer.appendChild(this.list);

    // monta estrutura
    this.root.appendChild(this.searchBar);
    this.root.appendChild(this.listContainer);

    // host
    this.host = ({ applyJsonFilter: () => {} } as any);

    if (options) {
      this.host = options.host as IVisualHost;
      options.element.appendChild(this.root);
    }

    // eventos de busca
    this.searchInput.addEventListener("input", () => {
      this.searchQuery = (this.searchInput.value || "").toLowerCase();
      this.renderList(); // só re-renderiza a lista
    });
    this.searchClear.addEventListener("click", () => {
      this.searchQuery = "";
      this.searchInput.value = "";
      this.renderList();
    });
  }

  // ===================== UPDATE =====================
  public update(options: VisualUpdateOptions): void {
    const dv = options.dataViews && options.dataViews[0];
    if (dv) this.settings = VisualSettings.parse(dv);

    // aplica visibilidade e fontes da barra de busca
    this.applySearchBarSettings();

    const categorical = dv?.categorical as DataViewCategorical;
    const cat = categorical?.categories && categorical.categories[0] || null;

    // Campo removido
    if (!cat) {
      this.items = [];
      this.currentTarget = null;
      this.lastCategoryQueryName = null;
      this.lastItemCount = 0;
      this.renderList();
      return;
    }

    // troca de campo
    const qn = (cat.source && cat.source.queryName) || null;
    if (this.lastCategoryQueryName && qn && qn !== this.lastCategoryQueryName) {
      this.items = [];
      this.lastItemCount = 0;
      // busca continua como está (não mexe no texto digitado)
    }
    this.lastCategoryQueryName = qn;

    // descobre/guarda o target p/ filtro
    this.currentTarget = this.extractTargetFromMetadata(cat);

    // reconstrói itens a partir do DataView atual (já filtrado pela página)
    this.rebuildItems(cat);

    // forçar 1ª seleção se único + forçar + lista encolheu/1ª vez + nada marcado
    const isSingle = this.settings.behavior_selectionMode;
    const canForce = isSingle && this.settings.behavior_forceSelection && this.items.length > 0;

    if (canForce) {
      let anySel = false;
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].selected) { anySel = true; break; }
      }
      const justShrunk = this.lastItemCount === 0 || this.items.length <= this.lastItemCount;

      if (!anySel && justShrunk) {
        for (let i = 0; i < this.items.length; i++) this.items[i].selected = false;
        this.items[0].selected = true;
        this.applyBasicFilter(); // aplica filtro JSON
      }
    }

    this.lastItemCount = this.items.length;

    // render só da lista (a barra já está configurada)
    this.renderList();
  }

  // ===================== DATA HELPERS =====================
  private rebuildItems(cat: DataViewCategoryColumn): void {
    const values = cat.values || [];
    const newItems: Item[] = new Array(values.length);

    // preserva seleção anterior por label
    const prevSel = new Set<string>();
    for (let i = 0; i < this.items.length; i++) if (this.items[i].selected) prevSel.add(this.items[i].label);

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const label = v == null ? "" : String(v);
      newItems[i] = { label, selected: prevSel.has(label) };
    }

    this.items = newItems;
  }

  private extractTargetFromMetadata(cat: DataViewCategoryColumn): BasicFilterTarget {
    const expr: any = (cat.source as any)?.expr;
    try {
      const col =
        (expr && (expr.ref || expr.level || (expr.source && expr.source.ref))) ||
        (cat.source as any)?.groupName;

      const tbl =
        (expr && expr.source && expr.source.entity) ||
        (expr && expr.arg && expr.arg.source && expr.arg.source.entity) ||
        (expr && expr.arg && expr.arg.arg && expr.arg.arg.entity);

      if (tbl && col) return { table: String(tbl), column: String(col) };
    } catch (_) {}

    const qn = cat.source?.queryName;
    if (qn && typeof qn === "string") {
      const dot = qn.lastIndexOf(".");
      if (dot > 0 && dot < qn.length - 1) {
        return { table: qn.substring(0, dot), column: qn.substring(dot + 1) };
      }
    }

    if (cat.source?.displayName) {
      return { table: "", column: cat.source.displayName };
    }
    return null;
  }

  // ===================== JSON FILTER =====================
  private applyBasicFilter(): void {
    if (!this.currentTarget) return;

    const selected: string[] = [];
    for (let i = 0; i < this.items.length; i++) if (this.items[i].selected) selected.push(this.items[i].label);

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

    (this.host as any).applyJsonFilter(bf, FILTER_OBJECT, FILTER_PROP, 0 /* Merge */);
  }

  // ===================== RENDER =====================
  private applySearchBarSettings(): void {
    const enabled = !!this.settings.search_enabled;
    this.searchBar.style.display = enabled ? "flex" : "none";

    this.searchInput.placeholder = this.settings.search_placeholder || "Pesquisar...";
    const sz = Math.max(8, Number(this.settings.search_fontSize) || 12);
    this.searchInput.style.fontSize = sz + "px";
  }

  private renderList(): void {
    while (this.list.firstChild) this.list.removeChild(this.list.firstChild);

    // aplica filtro de busca (apenas UI)
    const q = (this.searchQuery || "").trim().toLowerCase();
    const filteredIdxs: number[] = [];
    if (q === "") {
      for (let i = 0; i < this.items.length; i++) filteredIdxs.push(i);
    } else {
      for (let i = 0; i < this.items.length; i++) {
        if ((this.items[i].label || "").toLowerCase().indexOf(q) !== -1) filteredIdxs.push(i);
      }
    }

    if (filteredIdxs.length === 0) {
      const el = document.createElement("div");
      el.className = "empty";
      el.textContent = "Sem itens";
      this.list.appendChild(el);
      return;
    }

    const isSingle = this.settings.behavior_selectionMode; // true = radio, false = checkbox
    const listFont = Math.max(8, Number(this.settings.formatting_fontSize) || 12);
    const padding = Math.max(0, Number(this.settings.formatting_itemPadding) || 0);

    for (let k = 0; k < filteredIdxs.length; k++) {
      const idx = filteredIdxs[k];
      const item = this.items[idx];

      const li = document.createElement("li");
      li.className = "item" + (item.selected ? " selected" : "");
      li.style.fontSize = listFont + "px";
      li.style.paddingTop = padding + "px";
      li.style.paddingBottom = padding + "px";

      const input = document.createElement("input");
      input.type = isSingle ? "radio" : "checkbox";
      if (isSingle) input.name = "visual-selection-group";
      input.checked = item.selected;

      input.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onItemClick(idx);
      });

      const label = document.createElement("span");
      label.textContent = item.label;

      li.appendChild(input);
      li.appendChild(label);

      li.addEventListener("mousedown", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        ev.preventDefault();
      });
      li.addEventListener("click", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        this.onItemClick(idx);
      });

      this.list.appendChild(li);
    }
  }

  private onItemClick(indexInAllItems: number): void {
    const isSingle = this.settings.behavior_selectionMode;
    const isMulti = !isSingle;

    const item = this.items[indexInAllItems];
    if (!item) return;

    // evita "desmarcar" em modo único + forçar
    if (isSingle && this.settings.behavior_forceSelection && item.selected) {
      return;
    }

    if (isMulti) {
      item.selected = !item.selected;
    } else {
      for (let i = 0; i < this.items.length; i++) this.items[i].selected = false;
      item.selected = true;
    }

    // re-render da lista (mantém busca)
    this.renderList();

    // aplica filtro JSON
    this.applyBasicFilter();
  }

  // ===================== FORMAT PANE =====================
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

    if (options.objectName === "search") {
      instances.push({
        objectName: "search",
        properties: {
          enabled: this.settings.search_enabled,
          placeholder: this.settings.search_placeholder,
          fontSize: this.settings.search_fontSize
        },
        selector: {} as any
      } as any);
    }

    return instances;
  }
}

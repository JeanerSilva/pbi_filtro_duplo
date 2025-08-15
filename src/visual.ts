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

// ===== Types =====

type BasicFilterTarget = { table: string; column: string } | null;

interface BasicFilter {
  $schema: string; // http://powerbi.com/product/schema#basic
  filterType: number; // 1
  target: { table: string; column: string };
  operator: "In";
  values: any[];
}

interface Node {
  key: string;         // valor do nível
  label: string;       // texto exibido
  level: number;       // 0..(niveis-1)
  expanded: boolean;
  selected: boolean;   // seleção local
  children: Node[];
  parent: Node | null;
  isLeaf: boolean;
}

// ===== Consts =====
const FILTER_OBJECT = "general";
const FILTER_PROP = "filter";

// ===== Visual =====
export class Visual implements IVisual {
  private host!: IVisualHost;

  // DOM
  private root!: HTMLElement;
  private searchBar!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchClear!: HTMLElement;
  private listContainer!: HTMLElement;
  private treeRootEl!: HTMLElement;

  // Settings
  private settings: VisualSettings = new VisualSettings();

  // Data
  private categoryColumns: DataViewCategoryColumn[] = [];   // colunas por nível
  private targets: (BasicFilterTarget)[] = [];              // alvo por nível
  private rootNode: Node | null = null;                     // raiz sintética
  private levelsCount: number = 0;

  // Estado
  private searchQuery: string = "";
  private lastSignature: string = ""; // p/ rebuild heurístico

  // Regra: **um único nível ativo por vez** (facilita filtros estáveis)
  private activeSelectionLevel: number | null = null;

  constructor(options?: VisualConstructorOptions) {
    // DOM base
    this.root = document.createElement("div");
    this.root.className = "filtro-conjugado";

    // search
    const sb = document.createElement("div");
    sb.className = "search-bar";

    const wrap = document.createElement("div");
    wrap.className = "search-input-wrap";

    this.searchInput = document.createElement("input");
    this.searchInput.className = "search-input";
    this.searchInput.type = "text";
    this.searchInput.placeholder = "Pesquisar...";

    this.searchClear = document.createElement("div");
    this.searchClear.className = "search-clear";
    this.searchClear.textContent = "X";
    this.searchClear.title = "Limpar";

    wrap.appendChild(this.searchInput);
    wrap.appendChild(this.searchClear);
    sb.appendChild(wrap);
    this.searchBar = sb;

    // list container (árvore)
    this.listContainer = document.createElement("div");
    this.listContainer.className = "list-container";

    this.treeRootEl = document.createElement("ul");
    this.treeRootEl.className = "tree";
    this.listContainer.appendChild(this.treeRootEl);

    // mount
    this.root.appendChild(this.searchBar);
    this.root.appendChild(this.listContainer);

    // host
    this.host = ({ applyJsonFilter: () => {} } as any);
    if (options) {
      this.host = options.host as IVisualHost;
      options.element.appendChild(this.root);
    }

    // eventos busca
    this.searchInput.addEventListener("input", () => {
      this.searchQuery = (this.searchInput.value || "").toLowerCase();
      this.renderTree();
    });
    this.searchClear.addEventListener("click", () => {
      this.searchQuery = "";
      this.searchInput.value = "";
      this.renderTree();
    });
  }

  // ===================== UPDATE =====================
  public update(options: VisualUpdateOptions): void {
    const dv = options.dataViews && options.dataViews[0];

    if (dv) this.settings = VisualSettings.parse(dv);
    this.applySearchBarSettings();

    // coleta categorias por nível (ignorando níveis vazios)
    const categorical = dv?.categorical as DataViewCategorical;
    const cats = (categorical && categorical.categories) ? categorical.categories : [];
    this.categoryColumns = [];
    for (let i = 0; i < cats.length; i++) {
      if (cats[i] && cats[i].values && cats[i].values.length > 0) {
        this.categoryColumns.push(cats[i]);
      }
    }
    this.levelsCount = this.categoryColumns.length;

    // sem campo → limpa
    if (this.levelsCount === 0) {
      this.rootNode = null;
      this.targets = [];
      this.lastSignature = "";
      this.activeSelectionLevel = null;
      this.renderTree();
      return;
    }

    // guarda targets {table, column} por nível
    this.targets = new Array(this.levelsCount);
    for (let lvl = 0; lvl < this.levelsCount; lvl++) {
      this.targets[lvl] = this.extractTargetFromMetadata(this.categoryColumns[lvl]);
    }

    // (re)constrói árvore
    this.rebuildTree();

    // Seleção única + forçar: se nada marcado, força primeira **folha** visível
    if (this.settings.behavior_selectionMode && this.settings.behavior_forceSelection) {
      if (!this.anySelected(this.rootNode)) {
        const leaf = this.findFirstLeaf(this.rootNode);
        if (leaf) {
          this.clearAllSelections(this.rootNode);
          leaf.selected = true;
          this.activeSelectionLevel = leaf.level;
          this.applyBasicFilterForLevel(leaf.level);
        }
      }
    }

    // Render
    this.renderTree();
  }

  // ===================== BUILD TREE =====================
  private rebuildTree(): void {
    // assinatura simples (concat de todos valores em todos níveis)
    let sig = String(this.levelsCount) + "|";
    const count = this.categoryColumns[0].values.length;
    for (let lvl = 0; lvl < this.levelsCount; lvl++) {
      const col = this.categoryColumns[lvl];
      const vals = col.values || [];
      sig += "L" + lvl + ":" + vals.length + "|";
    }

    // sempre reconstruímos (robusto com filtros externos)
    const root: Node = {
      key: "__root__",
      label: "",
      level: -1,
      expanded: true,
      selected: false,
      children: [],
      parent: null,
      isLeaf: false
    };

    const countRows = this.categoryColumns[0].values.length;
    for (let row = 0; row < countRows; row++) {
      let parent = root;
      for (let lvl = 0; lvl < this.levelsCount; lvl++) {
        const col = this.categoryColumns[lvl];
        const v = col.values[row];
        const label = (v == null ? "" : String(v));
        let child = this.findChild(parent, label);
        if (!child) {
          child = {
            key: label,
            label: label,
            level: lvl,
            expanded: lvl < this.levelsCount - 1, // expande níveis intermediários
            selected: false,
            children: [],
            parent: parent,
            isLeaf: (lvl === this.levelsCount - 1)
          };
          parent.children.push(child);
        }
        parent = child;
      }
    }

    // preserva seleção prévia por caminho (label por nível)
    if (this.rootNode) {
      const prev = this.collectSelectedByPath(this.rootNode);
      if (prev.length > 0) this.restoreSelectionByPath(root, prev);
    }

    this.rootNode = root;
    this.lastSignature = sig;
  }

  private findChild(parent: Node, label: string): Node | null {
    for (let i = 0; i < parent.children.length; i++) {
      if (parent.children[i].key === label) return parent.children[i];
    }
    return null;
  }

  private collectSelectedByPath(n: Node | null): string[][] {
    const paths: string[][] = [];
    if (!n) return paths;
    this.walk(n, [], (node, path) => {
      if (node.selected) {
        const full = path.concat([node.label]);
        // remove a raiz sintética
        paths.push(full.slice(1));
      }
    });
    return paths;
  }

  private restoreSelectionByPath(root: Node, paths: string[][]): void {
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p];
      let cur: Node | null = root;
      for (let i = 0; i < path.length && cur; i++) {
        const ch = this.findChild(cur, path[i]);
        if (!ch) { cur = null; break; }
        cur = ch;
      }
      if (cur) cur.selected = true;
    }
  }

  // ===================== RENDER =====================
  private renderTree(): void {
  // limpa
  while (this.treeRootEl.firstChild) this.treeRootEl.removeChild(this.treeRootEl.firstChild);

  if (!this.rootNode || this.rootNode.children.length === 0) {
    const li = document.createElement("li");
    li.className = "node";
    li.textContent = "Sem itens";
    this.treeRootEl.appendChild(li);
    return;
  }

  const listFont = Math.max(8, Number(this.settings.formatting_fontSize) || 15);
  const padding  = Math.max(0, Number(this.settings.formatting_itemPadding) || 0);
  const isSingle = !!this.settings.behavior_selectionMode;
  const leafOnly = !!this.settings.behavior_leafOnly;

  // função recursiva
  const renderNode = (node: Node, ul: HTMLElement, depth: number) => {
    if (node.level >= 0) {
      // filtro de busca (exibe nós que casam OU que têm descendente que casa)
      if (!this.matchesSearch(node) && !this.descendantMatchesSearch(node)) {
        // não renderiza este ramo
        return;
      }

      const li = document.createElement("li");

      const row = document.createElement("div");
      // quando leafOnly: só mostra "selected" se for folha
      const isSelectedForStyle = node.selected && (!leafOnly || node.isLeaf);
      row.className = "node" + (isSelectedForStyle ? " selected" : "");
      row.style.paddingLeft = (depth * 14 + 2) + "px";
      row.style.fontSize = listFont + "px";
      row.style.paddingTop = padding + "px";
      row.style.paddingBottom = padding + "px";
      row.style.fontFamily = this.settings.formatting_fontFamily;
      row.style.color = this.settings.formatting_fontColor;
      row.style.fontWeight = this.settings.formatting_fontBold ? "600" : "400";
      row.style.fontStyle = this.settings.formatting_fontItalic ? "italic" : "normal";
      row.style.textDecoration = this.settings.formatting_fontUnderline ? "underline" : "none";

      

      // toggle (abre/fecha grupo)
      const toggle = document.createElement("span");
      toggle.className = "toggle";
      toggle.textContent = node.isLeaf ? "" : (node.expanded ? "▼" : "▶");
      toggle.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!node.isLeaf) {
          node.expanded = !node.expanded;
          this.renderTree();
        }
      });

      // input (radio/checkbox) — só para folhas quando leafOnly=true
      const showInput = !(leafOnly && !node.isLeaf);
      let inputOrSpacer: HTMLElement;

      if (showInput) {
        const input = document.createElement("input");
        input.type = isSingle ? "radio" : "checkbox";
        input.checked = node.selected;
        if (isSingle) input.name = "visual-selection-group";

        input.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onNodeClick(node, isSingle, leafOnly);
        });
        inputOrSpacer = input;
      } else {
        // spacer para manter alinhamento quando não exibimos o input
        const spacer = document.createElement("span");
        spacer.style.display = "inline-block";
        spacer.style.width = "14px";
        spacer.style.height = "14px";
        inputOrSpacer = spacer;
      }

      // label
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = node.label;

      // clique na linha
      row.addEventListener("mousedown", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        ev.preventDefault();
      });
      row.addEventListener("click", (ev) => {
        if ((ev as MouseEvent).button !== 0) return;
        this.onNodeClick(node, isSingle, leafOnly);
      });

      row.appendChild(toggle);
      row.appendChild(inputOrSpacer);
      row.appendChild(label);

      li.appendChild(row);
      ul.appendChild(li);

      if (!node.isLeaf && node.expanded) {
        const kidsUl = document.createElement("ul");
        kidsUl.className = "children";
        li.appendChild(kidsUl);
        for (let i = 0; i < node.children.length; i++) {
          renderNode(node.children[i], kidsUl, depth + 1);
        }
      }
    } else {
      // raiz sintética: renderiza filhos
      for (let i = 0; i < node.children.length; i++) {
        renderNode(node.children[i], ul, 0);
      }
    }
  };

  renderNode(this.rootNode, this.treeRootEl, 0);
}


  // ===================== CLICK / SELECTION =====================
  private onNodeClick(node: Node, isSingle: boolean, leafOnly: boolean): void {
    // se só folhas permitidas e não é folha => apenas expande/colapsa
    if (leafOnly && !node.isLeaf) {
      node.expanded = !node.expanded;
      this.renderTree();
      return;
    }

    // ativa o nível deste clique; regra: um nível por vez
    const lvl = node.level;
    this.activeSelectionLevel = lvl;

    if (isSingle) {
      this.clearAllSelections(this.rootNode);
      node.selected = true;
    } else {
      // múltipla: limpa seleções de outros níveis, permite múltiplos no mesmo nível
      this.clearSelectionsExceptLevel(this.rootNode, lvl);
      node.selected = !node.selected;
    }

    this.renderTree();

    // aplica filtro para o nível ativo
    this.applyBasicFilterForLevel(lvl);
  }

  private clearAllSelections(n: Node | null): void {
    if (!n) return;
    this.walk(n, [], (node) => { node.selected = false; });
  }

  private clearSelectionsExceptLevel(n: Node | null, level: number): void {
    if (!n) return;
    this.walk(n, [], (node) => {
      if (node.level !== level) node.selected = false;
    });
  }

  private anySelected(n: Node | null): boolean {
    let any = false;
    this.walk(n, [], (node) => { if (node.selected) any = true; });
    return any;
  }

  private findFirstLeaf(n: Node | null): Node | null {
    if (!n) return null;
    if (n.isLeaf && n.level >= 0) return n;
    for (let i = 0; i < n.children.length; i++) {
      const r = this.findFirstLeaf(n.children[i]);
      if (r) return r;
    }
    return null;
  }

  // ===================== APPLY FILTER =====================
  private applyBasicFilterForLevel(level: number): void {
    const target = this.targets[level];
    if (!target) return;

    // coleta os labels selecionados **neste nível**
    const labels: string[] = [];
    this.walk(this.rootNode, [], (node) => {
      if (node.level === level && node.selected) labels.push(node.label);
    });

    // nada selecionado → remove filtro deste visual (nesse objeto/prop)
    if (labels.length === 0) {
      (this.host as any).applyJsonFilter(null, "general", "filter", 2 /* Remove */);
      return;
    }

    const bf: BasicFilter = {
      $schema: "http://powerbi.com/product/schema#basic",
      filterType: 1,
      operator: "In",
      target: { table: target.table, column: target.column },
      values: labels
    };

    // Merge: combina com outros visuais e com filtros existentes
    (this.host as any).applyJsonFilter(bf, "general", "filter", 0 /* Merge */);
  }

  // ===================== UTILS =====================
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
    if (cat.source?.displayName) return { table: "", column: cat.source.displayName };
    return null;
  }

  private applySearchBarSettings(): void {
    const enabled = !!this.settings.search_enabled;
    this.searchBar.style.display = enabled ? "flex" : "none";
    this.searchInput.placeholder = this.settings.search_placeholder || "Pesquisar...";
    const sz = Math.max(8, Number(this.settings.search_fontSize) || 15);
    this.searchInput.style.fontSize = sz + "px";
  }

  private matchesSearch(node: Node): boolean {
    const q = this.searchQuery;
    if (!q) return true;
    return (node.label || "").toLowerCase().indexOf(q) !== -1;
  }

  private descendantMatchesSearch(node: Node): boolean {
    const q = this.searchQuery;
    if (!q) return true;
    for (let i = 0; i < node.children.length; i++) {
      const ch = node.children[i];
      if (this.matchesSearch(ch) || this.descendantMatchesSearch(ch)) return true;
    }
    return false;
  }

  private walk(n: Node | null, path: string[], fn: (node: Node, path: string[]) => void): void {
    if (!n) return;
    fn(n, path);
    for (let i = 0; i < n.children.length; i++) {
      this.walk(n.children[i], path.concat([n.label]), fn);
    }
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
          forceSelection: this.settings.behavior_forceSelection,
          leafOnly: this.settings.behavior_leafOnly
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

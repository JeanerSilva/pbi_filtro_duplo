"use strict";

import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import DataViewCategorical = powerbi.DataViewCategorical;


import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;


import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualSettings, SelectionModeEnum } from "./settings";

interface Item {
  label: string;
  selectionId: ISelectionId; // <- visuals.ISelectionId
  selected: boolean;
}



export class Visual implements IVisual {
    private host!: IVisualHost;
    
    private selectionManager: ISelectionManager;

    private root: HTMLElement;
    private listContainer: HTMLElement;
    private list: HTMLElement;

    private settings: VisualSettings = new VisualSettings();
    private items: Item[] = [];
    private suppressNextSelectCallback = false;

    
    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        // isto funciona na 5.11
        this.selectionManager =
            (this.host as any).createSelectionManager
                ? (this.host as any).createSelectionManager()
                : ({} as ISelectionManager); // fallback dev; não será chamado se não existir



        this.root = document.createElement("div");
        this.root.className = "filtro-conjugado";

        this.listContainer = document.createElement("div");
        this.listContainer.className = "list-container";

        this.list = document.createElement("ul");
        this.list.className = "list";

        this.listContainer.appendChild(this.list);
        this.root.appendChild(this.listContainer);
        options.element.appendChild(this.root);

        // Recebe seleções de outros visuais (sincronização)
        this.selectionManager.registerOnSelectCallback((ids) => {
            if (this.suppressNextSelectCallback) {
                // evita loop quando nós próprios iniciamos a seleção
                this.suppressNextSelectCallback = false;
                return;
            }
            this.applyExternalSelection(ids || []);
        });

        // Permitir menu de contexto para copiar texto
        this.root.addEventListener("contextmenu", () => { /* não interceptar */ });
    }

    public update(options: VisualUpdateOptions): void {
        const dataView = options.dataViews && options.dataViews[0];
        if (!dataView) {
            this.renderEmpty("Sem dados");
            return;
        }

        this.settings = VisualSettings.parse(dataView);

        const categorical = dataView.categorical as DataViewCategorical;
        const cat = categorical && categorical.categories && categorical.categories[0];
        const values = cat && cat.values || [];

        if (!cat || values.length === 0) {
            this.renderEmpty("Sem itens");
            return;
        }

        // Converte para itens clicáveis
        const newItems: Item[] = [];
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            const selectionId = this.host
                .createSelectionIdBuilder()
                .withCategory(cat, i)
                .createSelectionId();

            newItems.push({ label: (v == null ? "" : String(v)), selectionId, selected: false });
        }

        this.items = newItems;

        // Aplica seleção corrente conhecida pelo SelectionManager (sincronizada)
        // Obs: não há API pública para "ler" seleção atual, então usamos o callback:
        // se nenhuma veio ainda, respeitamos a força de seleção (single).
        // Se modo único e nada está selecionado, forçamos a primeira seleção.
        if (this.settings.behavior_selectionMode === SelectionModeEnum.Single) {
            const anySelected = this.items.some(it => it.selected);
            if (!anySelected) {
                // Força primeira seleção quando configurado
                if (this.settings.behavior_forceSelection && this.items.length > 0) {
                    this.suppressNextSelectCallback = true;
                    this.selectionManager.select(this.items[0].selectionId, false);
                    this.items[0].selected = true;
                }
            }
        }

        this.render();
        this.applyStyles();
    }

    private render(): void {
        // limpa a lista
        while (this.list.firstChild) this.list.removeChild(this.list.firstChild);

        if (this.items.length === 0) {
            this.renderEmpty("Sem itens");
            return;
        }

        // constroi LI
        for (const item of this.items) {
            const li = document.createElement("li");
            li.className = "item" + (item.selected ? " selected" : "");
            li.textContent = item.label;

            // Tamanho de fonte e padding por item
            li.style.fontSize = `${this.settings.formatting_fontSize}px`;
            li.style.paddingTop = `${this.settings.formatting_itemPadding}px`;
            li.style.paddingBottom = `${this.settings.formatting_itemPadding}px`;

            // Clique somente com botão esquerdo (para não interferir no copiar com botão direito)
            li.addEventListener("mousedown", (ev) => {
                if (ev.button !== 0) return;
                ev.preventDefault();
            });

            li.addEventListener("click", (ev) => {
                // apenas botão esquerdo
                if ((ev as MouseEvent).button !== 0) return;
                this.onItemClick(item, (ev as MouseEvent).ctrlKey || (ev as MouseEvent).metaKey);
            });

            this.list.appendChild(li);
        }
    }

    private renderEmpty(msg: string): void {
        while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
        const li = document.createElement("div");
        li.className = "empty";
        li.textContent = msg;
        this.list.appendChild(li);
    }

    private onItemClick(item: Item, userMultiKey: boolean): void {
        const isMultiMode = this.settings.behavior_selectionMode === SelectionModeEnum.Multiple;
        const multi = isMultiMode ? (userMultiKey || false) : false;

        if (isMultiMode) {
            // alterna seleção local
            item.selected = !item.selected;
        } else {
            // single: limpa todos e seleciona só o item
            for (const it of this.items) it.selected = false;
            item.selected = true;
        }

        // Atualiza UI local
        this.updateListSelectionClasses();

        // Dispara seleção no host sem apagar outras visuais (poder de mando)
        this.suppressNextSelectCallback = true;
        if (isMultiMode) {
            const selectedIds = this.items.filter(i => i.selected).map(i => i.selectionId);
            if (selectedIds.length > 0) {
                this.selectionManager.select(selectedIds, true);
            } else {
                // se desmarcou tudo no multi, limpamos só desta visual
                this.selectionManager.clear();
            }
        } else {
            this.selectionManager.select(item.selectionId, false);
        }
    }

    private applyExternalSelection(ids: ISelectionId[]): void {
        // Marca seleção local conforme o que veio do host
        const keys = new Set(ids.map(id => id.getKey()));
        let changed = false;

        if (ids.length === 0) {
            // nenhuma seleção aplicada externamente -> em modo único, podemos manter forceSelection
            if (this.settings.behavior_selectionMode === SelectionModeEnum.Single && this.settings.behavior_forceSelection && this.items.length > 0) {
                // garante 1º selecionado
                for (const it of this.items) it.selected = false;
                this.items[0].selected = true;
                changed = true;
            } else {
                for (const it of this.items) {
                    if (it.selected) { it.selected = false; changed = true; }
                }
            }
        } else {
            for (const it of this.items) {
                const sel = keys.has(it.selectionId.getKey());
                if (it.selected !== sel) {
                    it.selected = sel;
                    changed = true;
                }
            }
        }

        if (changed) this.updateListSelectionClasses();
    }

    private updateListSelectionClasses(): void {
        const children = Array.from(this.list.children);
        for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            if (!el.classList.contains("item")) continue;
            const it = this.items[i];
            if (!it) continue;
            el.classList.toggle("selected", !!it.selected);
        }
    }

    private applyStyles(): void {
        // Nada adicional aqui; fonte/padding é por item
    }

    // Persistência de propriedades (quando usuário mexe no painel)
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
    });
  }

  if (options.objectName === "formatting") {
    instances.push({
      objectName: "formatting",
      properties: {
        fontSize: this.settings.formatting_fontSize,
        itemPadding: this.settings.formatting_itemPadding
      },
      selector: {} as any
    });
  }

  return instances;
}

}

import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
export declare class Visual implements IVisual {
    private host;
    private selectionManager;
    private root;
    private listContainer;
    private list;
    private settings;
    private items;
    private suppressNextSelectCallback;
    private externalKeys;
    private didInitialForce;
    private itemsSignature;
    private maxItemCount;
    private lastItemCount;
    private filteredLock;
    constructor(options?: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
    private hasDataViewCategories;
    /**
     * Reconstrói items respeitando um "lock" de domínio filtrado:
     * - Aceita sempre reduções (count diminui ou igual)
     * - Rejeita aumentos (count cresce) enquanto filteredLock estiver ativo
     * Retorna {changed, count}.
     */
    private rebuildItemsWithLock;
    private render;
    private onItemClick;
    private updateListSelectionClasses;
    private applyExternalSelection;
    enumerateObjectInstances(options: powerbi.EnumerateVisualObjectInstancesOptions): powerbi.VisualObjectInstanceEnumeration;
}

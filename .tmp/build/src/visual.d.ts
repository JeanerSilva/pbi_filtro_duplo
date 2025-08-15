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
    private didInitialForce;
    private lastItemCount;
    private lastCategoryQueryName;
    constructor(options?: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
    private rebuildItems;
    private render;
    private onItemClick;
    private updateListSelectionClasses;
    enumerateObjectInstances(options: powerbi.EnumerateVisualObjectInstancesOptions): powerbi.VisualObjectInstanceEnumeration;
}

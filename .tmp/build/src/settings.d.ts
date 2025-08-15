import powerbi from "powerbi-visuals-api";
export declare class VisualSettings {
    behavior_selectionMode: boolean;
    behavior_forceSelection: boolean;
    formatting_fontSize: number;
    formatting_itemPadding: number;
    search_enabled: boolean;
    search_placeholder: string;
    search_fontSize: number;
    static parse(dataView: powerbi.DataView): VisualSettings;
}

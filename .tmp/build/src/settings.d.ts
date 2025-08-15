import powerbi from "powerbi-visuals-api";
export declare class VisualSettings {
    behavior_selectionMode: boolean;
    behavior_forceSelection: boolean;
    behavior_leafOnly: boolean;
    formatting_fontSize: number;
    formatting_itemPadding: number;
    formatting_fontFamily: string;
    formatting_fontColor: string;
    formatting_fontBold: boolean;
    formatting_fontItalic: boolean;
    formatting_fontUnderline: boolean;
    search_enabled: boolean;
    search_placeholder: string;
    search_fontSize: number;
    static parse(dataView: powerbi.DataView): VisualSettings;
}

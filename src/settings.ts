"use strict";
import powerbi from "powerbi-visuals-api";

export class VisualSettings {
  // comportamento
  public behavior_selectionMode: boolean = true;   // true = único (radio), false = múltiplo (checkbox)
  public behavior_forceSelection: boolean = true;
  public behavior_leafOnly: boolean = true;        // NOVO: só permite clicar folhas

  // formatação da lista
  public formatting_fontSize: number = 12;
  public formatting_itemPadding: number = 4;

  // NOVO: tipografia
  public formatting_fontFamily: string = "DIN, Segoe UI, Arial, sans-serif";
  public formatting_fontColor: string = "#222222";
  public formatting_fontBold: boolean = false;
  public formatting_fontItalic: boolean = false;
  public formatting_fontUnderline: boolean = false;

  // busca
  public search_enabled: boolean = true;
  public search_placeholder: string = "Pesquisar...";
  public search_fontSize: number = 15;

  public static parse(dataView: powerbi.DataView): VisualSettings {
    const s = new VisualSettings();
    const objects: any = dataView && dataView.metadata && (dataView.metadata.objects || {});

    // ... (já existentes)
    s.formatting_fontSize = getNumber(objects, "formatting", "fontSize", s.formatting_fontSize);
    s.formatting_itemPadding = getNumber(objects, "formatting", "itemPadding", s.formatting_itemPadding);

    // NOVO: tipografia
    s.formatting_fontFamily = getText(objects, "formatting", "fontFamily", s.formatting_fontFamily);
    s.formatting_fontColor  = getColor(objects, "formatting", "fontColor",  s.formatting_fontColor);
    s.formatting_fontBold   = getBool(objects, "formatting", "fontBold",   s.formatting_fontBold);
    s.formatting_fontItalic = getBool(objects, "formatting", "fontItalic", s.formatting_fontItalic);
    s.formatting_fontUnderline = getBool(objects, "formatting", "fontUnderline", s.formatting_fontUnderline);


    s.behavior_selectionMode = getBool(objects, "behavior", "selectionMode", s.behavior_selectionMode);
    s.behavior_forceSelection = getBool(objects, "behavior", "forceSelection", s.behavior_forceSelection);
    s.behavior_leafOnly     = getBool(objects, "behavior", "leafOnly", s.behavior_leafOnly);

    s.formatting_fontSize = getNumber(objects, "formatting", "fontSize", s.formatting_fontSize);
    s.formatting_itemPadding = getNumber(objects, "formatting", "itemPadding", s.formatting_itemPadding);

    s.search_enabled = getBool(objects, "search", "enabled", s.search_enabled);
    s.search_placeholder = getText(objects, "search", "placeholder", s.search_placeholder);
    s.search_fontSize = getNumber(objects, "search", "fontSize", s.search_fontSize);

    return s;
  }
}

// helper novo p/ cor (fill.solid.color)
function getColor(objects: any, category: string, prop: string, def: string): string {
  const cat = getCategory(objects, category);
  const fill = cat && cat[prop];
  const color = fill && fill.solid && fill.solid.color;
  return (typeof color === "string" && color) ? color : def;
}

// helpers
function getCategory(objects: any, category: string): any {
  return (objects && objects[category]) ? objects[category] : {};
}
function getBool(objects: any, category: string, prop: string, def: boolean): boolean {
  const cat = getCategory(objects, category);
  return (typeof cat[prop] === "boolean") ? cat[prop] : def;
}
function getNumber(objects: any, category: string, prop: string, def: number): number {
  const cat = getCategory(objects, category);
  return (typeof cat[prop] === "number") ? cat[prop] : def;
}
function getText(objects: any, category: string, prop: string, def: string): string {
  const cat = getCategory(objects, category);
  return (typeof cat[prop] === "string") ? cat[prop] : def;
}

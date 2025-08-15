"use strict";
import powerbi from "powerbi-visuals-api";

export class VisualSettings {
  // comportamento
  public behavior_selectionMode: boolean = true;   // true = único (radio), false = múltiplo (checkbox)
  public behavior_forceSelection: boolean = true;

  // formatação da lista
  public formatting_fontSize: number = 12;
  public formatting_itemPadding: number = 4;

  // busca
  public search_enabled: boolean = true;
  public search_placeholder: string = "Pesquisar...";
  public search_fontSize: number = 12;

  public static parse(dataView: powerbi.DataView): VisualSettings {
    const s = new VisualSettings();
    const objects: any = dataView && dataView.metadata && (dataView.metadata.objects || {});

    s.behavior_selectionMode = getBool(objects, "behavior", "selectionMode", s.behavior_selectionMode);
    s.behavior_forceSelection = getBool(objects, "behavior", "forceSelection", s.behavior_forceSelection);

    s.formatting_fontSize = getNumber(objects, "formatting", "fontSize", s.formatting_fontSize);
    s.formatting_itemPadding = getNumber(objects, "formatting", "itemPadding", s.formatting_itemPadding);

    s.search_enabled = getBool(objects, "search", "enabled", s.search_enabled);
    s.search_placeholder = getText(objects, "search", "placeholder", s.search_placeholder);
    s.search_fontSize = getNumber(objects, "search", "fontSize", s.search_fontSize);

    return s;
  }
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

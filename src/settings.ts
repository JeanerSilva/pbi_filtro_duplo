import powerbi from "powerbi-visuals-api";

export class VisualSettings {
  // comportamento
  public behavior_selectionMode: boolean = true;
  public behavior_forceSelection: boolean = true;
  public behavior_leafOnly: boolean = true;

  // formatação
  public formatting_fontSize: number = 12;
  public formatting_itemPadding: number = 4;

  public formatting_fontFamily: string = "DIN, Segoe UI, Arial, sans-serif";
  public formatting_fontColor: string = "#222222";
  public formatting_fontBold: boolean = false;
  public formatting_fontItalic: boolean = false;
  public formatting_fontUnderline: boolean = false;

  // busca
  public search_enabled: boolean = true;
  public search_placeholder: string = "Pesquisar...";
  public search_fontSize: number = 12;

  public static parse(dv: powerbi.DataView): VisualSettings {
    const s = new VisualSettings();
    const objects: any = dv && dv.metadata && (dv.metadata.objects || {});

    // comportamento
    s.behavior_selectionMode  = getBool(objects, "behavior", "selectionMode",  s.behavior_selectionMode);
    s.behavior_forceSelection = getBool(objects, "behavior", "forceSelection", s.behavior_forceSelection);
    s.behavior_leafOnly       = getBool(objects, "behavior", "leafOnly",       s.behavior_leafOnly);

    // formatação
    s.formatting_fontSize     = getNumber(objects, "formatting", "fontSize",   s.formatting_fontSize);
    s.formatting_itemPadding  = getNumber(objects, "formatting", "itemPadding",s.formatting_itemPadding);
    s.formatting_fontFamily   = getText  (objects, "formatting", "fontFamily", s.formatting_fontFamily);
    s.formatting_fontColor    = getColor (objects, "formatting", "fontColor",  s.formatting_fontColor);
    s.formatting_fontBold     = getBool  (objects, "formatting", "fontBold",   s.formatting_fontBold);
    s.formatting_fontItalic   = getBool  (objects, "formatting", "fontItalic", s.formatting_fontItalic);
    s.formatting_fontUnderline= getBool  (objects, "formatting", "fontUnderline", s.formatting_fontUnderline);

    // busca
    s.search_enabled          = getBool  (objects, "search", "enabled",        s.search_enabled);
    s.search_placeholder      = getText  (objects, "search", "placeholder",    s.search_placeholder);
    s.search_fontSize         = getNumber(objects, "search", "fontSize",       s.search_fontSize);

    return s;
  }
}

// helpers
function pick(objects: any, category: string) {
  return (objects && objects[category]) ? objects[category] : {};
}
function getBool(objects: any, cat: string, prop: string, def: boolean) {
  const o = pick(objects, cat); return typeof o[prop] === "boolean" ? o[prop] : def;
}
function getNumber(objects: any, cat: string, prop: string, def: number) {
  const o = pick(objects, cat); return typeof o[prop] === "number" ? o[prop] : def;
}
function getText(objects: any, cat: string, prop: string, def: string) {
  const o = pick(objects, cat); return typeof o[prop] === "string" ? o[prop] : def;
}
function getColor(objects: any, cat: string, prop: string, def: string) {
  const o = pick(objects, cat);
  const fill = o && o[prop];
  const color = fill && fill.solid && fill.solid.color;
  return (typeof color === "string" && color) ? color : def;
}

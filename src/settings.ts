import powerbi from "powerbi-visuals-api";

export class VisualSettings {
  // true = seleção única, false = múltipla
  behavior_selectionMode: boolean = true;
  behavior_forceSelection: boolean = true;

  formatting_fontSize: number = 12;
  formatting_itemPadding: number = 4;

  public static parse(dataView: powerbi.DataView): VisualSettings {
    const objects = dataView && dataView.metadata && (dataView.metadata.objects || {});
    const s = new VisualSettings();

    s.behavior_selectionMode = getBool(objects, "behavior", "selectionMode", true);
    s.behavior_forceSelection = getBool(objects, "behavior", "forceSelection", true);

    s.formatting_fontSize = getNumber(objects, "formatting", "fontSize", 12);
    s.formatting_itemPadding = getNumber(objects, "formatting", "itemPadding", 4);

    return s;
  }
}

function getObj(objects: any, objectName: string) {
  return (objects && objects[objectName]) || {};
}
function getNumber(objects: any, objectName: string, propertyName: string, defaultValue: number): number {
  const o = getObj(objects, objectName);
  const v = o[propertyName];
  return (typeof v === "number" && !isNaN(v)) ? v : defaultValue;
}
function getBool(objects: any, objectName: string, propertyName: string, defaultValue: boolean): boolean {
  const o = getObj(objects, objectName);
  const v = o[propertyName];
  return (typeof v === "boolean") ? v : defaultValue;
}

import { applyOps, assetIds, type Design, type Op, type Sources } from '../../../../mcp/recipe';
import { newId, type Snapshot } from '../doc/design';
import type { Asset, Element, Fill, Id, Page } from '../doc/types';
import { ensureFont, FONTS, fontsVersion } from '../fonts/fonts';
import { assetFromUrl } from '../io/upload';
import { libUrl } from '../templates';
import { layoutText } from '../text/layout';
import type { Editor } from '../editor/Editor';

export interface Scene {
  design: Design;
  pageIds: Map<string, Id>;
  elementIds: Map<string, Id>;
  version: number;
}

export interface PreparedPlan {
  scene: Scene;
  design: Design;
  ops: Op[];
  version: number;
}

export interface AppliedPlan {
  changedElements: Id[];
  changedPages: Id[];
  missingImages: string[];
}

const KNOWN_FONTS = new Set(FONTS.map((font) => font.family));

export function sceneFromSnapshot(snapshot: Snapshot): Scene {
  const pageIds = new Map<string, Id>();
  const elementIds = new Map<string, Id>();
  const realToStable = new Map<Id, string>();
  snapshot.pageOrder.forEach((realPageId, pageIndex) => {
    const stablePageId = `p${pageIndex + 1}`;
    pageIds.set(stablePageId, realPageId);
    const page = snapshot.pages[realPageId];
    if (!page) return;
    page.elementIds.forEach((realElementId, elementIndex) => {
      const stableElementId = `${stablePageId}-e${elementIndex + 1}`;
      elementIds.set(stableElementId, realElementId);
      realToStable.set(realElementId, stableElementId);
    });
  });

  const pages = snapshot.pageOrder.flatMap((realPageId, pageIndex) => {
    const page = snapshot.pages[realPageId];
    if (!page) return [];
    const stablePageId = `p${pageIndex + 1}`;
    const elements = page.elementIds.flatMap((realElementId, elementIndex) => {
      const element = snapshot.elements[realElementId];
      if (!element) return [];
      const stableElementId = `${stablePageId}-e${elementIndex + 1}`;
      const copy = structuredClone(element) as Element;
      copy.id = stableElementId;
      if (copy.type === 'line') {
        if (copy.from) copy.from = realToStable.get(copy.from) ?? copy.from;
        if (copy.to) copy.to = realToStable.get(copy.to) ?? copy.to;
      }
      return [copy];
    });
    return [{ ...structuredClone(page), id: stablePageId, elements }];
  });

  const orig: Record<string, string> = {};
  for (const page of pages) for (const element of page.elements) if (element.type === 'text') orig[element.id] = element.text;

  const design: Design = {
    title: snapshot.meta.title,
    width: snapshot.meta.width,
    height: snapshot.meta.height,
    formatId: snapshot.meta.formatId,
    pages: pages as Design['pages'],
    images: {},
    cover: [],
    fit: {},
    orig,
    resized: {},
    tpl: [],
    seq: 0,
  };

  return { design, pageIds, elementIds, version: snapshot.version };
}

function opFonts(ops: Op[]) {
  const fonts = new Map<string, Set<number>>();
  const add = (family: unknown, weight: unknown) => {
    if (typeof family !== 'string' || !family.trim()) return;
    const set = fonts.get(family) ?? new Set<number>();
    set.add(typeof weight === 'number' ? weight : 400);
    fonts.set(family, set);
  };
  for (const op of ops) {
    if (op.op === 'style') {
      const props = op.props as Record<string, unknown>;
      add(props.fontFamily ?? props.font, props.fontWeight);
    }
    if (op.op === 'add') {
      const element = op.element as Record<string, unknown>;
      add(element.fontFamily ?? element.font, element.fontWeight);
    }
  }
  return fonts;
}

async function prepareFonts(snapshot: Snapshot, ops: Op[]) {
  const fonts = opFonts(ops);
  for (const page of Object.values(snapshot.pages)) {
    for (const elementId of page.elementIds) {
      const element = snapshot.elements[elementId];
      if (element?.type === 'text') {
        const set = fonts.get(element.fontFamily) ?? new Set<number>();
        set.add(element.fontWeight);
        fonts.set(element.fontFamily, set);
      }
    }
  }
  await Promise.all([...fonts].flatMap(([family, weights]) => [...weights].map((weight) => ensureFont(family, weight))));
  await document.fonts.ready;
}

export async function preparePlan(snapshot: Snapshot, ops: Op[]): Promise<PreparedPlan> {
  if (!ops.length) throw new Error('The design plan does not contain any edits.');
  if (ops.length > 60) throw new Error('The design plan contains too many edits.');
  await prepareFonts(snapshot, ops);
  const scene = sceneFromSnapshot(snapshot);
  const fonts = new Set<string>([...KNOWN_FONTS, 'Host Grotesk']);
  for (const page of scene.design.pages) for (const element of page.elements) if (element.type === 'text') fonts.add(element.fontFamily);
  const sources: Sources = {
    fonts,
    measure: (element) => {
      const layout = layoutText(element, fontsVersion());
      return { height: layout.height, width: layout.maxLineWidth };
    },
  };
  const design = structuredClone(scene.design);
  applyOps(design, ops, sources);
  return { scene, design, ops, version: snapshot.version };
}

function findPage(design: Design, id: string) {
  return design.pages.find((page) => page.id === id);
}

function findElement(design: Design, id: string) {
  for (const page of design.pages) {
    const element = page.elements.find((item) => item.id === id);
    if (element) return element;
  }
  return undefined;
}

function elementPatch(base: Element, target: Element) {
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(target)]);
  for (const key of keys) {
    if (key === 'id') continue;
    if (!(key in target)) {
      patch[key] = undefined;
      continue;
    }
    const before = (base as unknown as Record<string, unknown>)[key];
    const after = (target as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) patch[key] = after;
  }
  return patch as Partial<Element>;
}

function mapFill(fill: Fill, assets: Map<string, Asset>): Fill {
  if (fill.type !== 'image') return fill;
  const asset = assets.get(fill.assetId);
  if (asset) return { ...fill, assetId: asset.id };
  return fill.assetId.startsWith('web:') || fill.assetId.startsWith('lib:') ? { type: 'solid', color: '#FFFFFF' } : fill;
}

function coverCrop(imageWidth: number, imageHeight: number, width: number, height: number) {
  const imageRatio = imageWidth / imageHeight;
  const boxRatio = width / height;
  if (imageRatio > boxRatio) {
    const cropWidth = boxRatio / imageRatio;
    return { x: (1 - cropWidth) / 2, y: 0, w: cropWidth, h: 1 };
  }
  const cropHeight = imageRatio / boxRatio;
  return { x: 0, y: (1 - cropHeight) / 2, w: 1, h: cropHeight };
}

function mapElement(element: Element, realIds: Map<string, Id>, assets: Map<string, Asset>, cover: Set<string>): Element {
  const copy = structuredClone(element);
  if (copy.type === 'line') {
    if (copy.from) copy.from = realIds.get(copy.from) ?? copy.from;
    if (copy.to) copy.to = realIds.get(copy.to) ?? copy.to;
  }
  if (copy.type === 'image' && copy.assetId) {
    const asset = assets.get(copy.assetId);
    if (asset) {
      copy.assetId = asset.id;
      if (cover.has(element.id)) copy.crop = coverCrop(asset.width, asset.height, copy.w, copy.h);
    } else if (copy.assetId.startsWith('web:') || copy.assetId.startsWith('lib:')) copy.assetId = null;
  }
  if (copy.type === 'shape' && copy.fill.type === 'image') copy.fill = mapFill(copy.fill, assets) as typeof copy.fill;
  return copy;
}

async function fetchAssets(design: Design, doc: { getAsset(id: Id): Asset | undefined }) {
  const assets = new Map<string, Asset>();
  const missing: string[] = [];
  const ids = assetIds(design);
  await Promise.all(
    ids.map(async (id) => {
      if (doc.getAsset(id)) return;
      const image = design.images[id];
      const url = image?.url ?? (id.startsWith('lib:') ? libUrl(id) : '');
      if (!url) return;
      try {
        const asset = await assetFromUrl(url, image?.credit ? 'Designer image' : id.split('/').pop() ?? 'image', image?.credit);
        assets.set(id, asset);
      } catch {
        missing.push(url);
      }
    }),
  );
  return { assets, missing };
}

function pagePatch(base: Design['pages'][number] | undefined, target: Design['pages'][number], assets: Map<string, Asset>) {
  const patch: Record<string, unknown> = {};
  const before = base as unknown as Record<string, unknown> | undefined;
  const after = target as unknown as Record<string, unknown>;
  for (const key of ['name', 'notes', 'transition', 'duration', 'hidden']) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after[key])) patch[key] = after[key];
  }
  const background = mapFill(target.background, assets);
  if (JSON.stringify(before?.background) !== JSON.stringify(background)) patch.background = background;
  return patch;
}

export async function applyPlan(editor: Editor, plan: PreparedPlan): Promise<AppliedPlan> {
  if (editor.doc.snapshot.version !== plan.version) throw new Error('The design changed while this plan was waiting. Ask the designer again.');
  const doc = editor.doc;
  const base = plan.scene.design;
  const target = plan.design;
  const { assets, missing } = await fetchAssets(target, doc);

  const realPageIds = new Map(plan.scene.pageIds);
  const realElementIds = new Map(plan.scene.elementIds);
  for (const page of target.pages) if (!realPageIds.has(page.id)) realPageIds.set(page.id, newId());
  for (const page of target.pages) for (const element of page.elements) if (!realElementIds.has(element.id)) realElementIds.set(element.id, newId());

  const targetPageIds = new Set(target.pages.map((page) => page.id));
  const targetElementIds = new Set(target.pages.flatMap((page) => page.elements.map((element) => element.id)));
  const deletedPageIds = [...plan.scene.pageIds].filter(([stable]) => !targetPageIds.has(stable)).map(([, real]) => real);
  const deletedElementIds = [...plan.scene.elementIds]
    .filter(([stable]) => !targetElementIds.has(stable))
    .map(([, real]) => real)
    .filter((real) => {
      const stable = [...plan.scene.elementIds].find(([, id]) => id === real)?.[0];
      const page = stable ? findPage(base, stable.split('-')[0]) : undefined;
      return !page || !deletedPageIds.includes(plan.scene.pageIds.get(page.id) ?? '');
    });

  const changedElements: Id[] = [];
  const changedPages: Id[] = [];
  doc.undo.stopCapturing();
  doc.transact(() => {
    if (deletedElementIds.length) doc.deleteElements(deletedElementIds);
    for (const realPageId of deletedPageIds) doc.deletePage(realPageId);

    for (const targetPage of target.pages) {
      const realPageId = realPageIds.get(targetPage.id)!;
      const basePage = findPage(base, targetPage.id);
      const patch = pagePatch(basePage, targetPage, assets);
      if (basePage) {
        if (Object.keys(patch).length) {
          doc.updatePage(realPageId, patch as Partial<Omit<Page, 'id' | 'elementIds'>>);
          changedPages.push(realPageId);
        }
      } else {
        doc.addPage({
          id: realPageId,
          name: targetPage.name,
          background: mapFill(targetPage.background, assets),
          notes: targetPage.notes,
          transition: targetPage.transition,
          duration: targetPage.duration,
          hidden: (targetPage as { hidden?: boolean }).hidden,
        });
        changedPages.push(realPageId);
      }
    }

    const cover = new Set(target.cover);
    for (const targetPage of target.pages) {
      const realPageId = realPageIds.get(targetPage.id)!;
      for (const targetElement of targetPage.elements) {
        const realElementId = realElementIds.get(targetElement.id)!;
        const baseElement = findElement(base, targetElement.id);
        const mapped = mapElement(targetElement, realElementIds, assets, cover);
        if (baseElement) {
          const patch = elementPatch(baseElement, mapped);
          if (Object.keys(patch).length) {
            doc.updateElement(realElementId, patch);
            changedElements.push(realElementId);
          }
        } else {
          doc.addElement(realPageId, { ...mapped, id: realElementId });
          changedElements.push(realElementId);
        }
      }
    }

    for (const targetPage of target.pages) {
      const realPageId = realPageIds.get(targetPage.id)!;
      const yPage = doc.pages.get(realPageId);
      if (!yPage) continue;
      const order = yPage.get('elementIds') as import('yjs').Array<Id>;
      const wanted = targetPage.elements.map((element) => realElementIds.get(element.id)!);
      order.delete(0, order.length);
      order.insert(0, wanted);
    }

    const pageOrder = target.pages.map((page) => realPageIds.get(page.id)!);
    doc.pageOrder.delete(0, doc.pageOrder.length);
    doc.pageOrder.insert(0, pageOrder);
    if (plan.design.title !== editor.doc.snapshot.meta.title) doc.setMeta({ title: plan.design.title });
  });

  for (const asset of assets.values()) doc.addAsset(asset);
  editor.refitAllText();
  if (changedElements.length) editor.select(changedElements, { expandGroups: false });
  else if (changedPages.length) editor.ui.set({ activePageId: changedPages[0], selection: [] });
  editor.pruneSelection();
  return { changedElements, changedPages, missingImages: missing };
}

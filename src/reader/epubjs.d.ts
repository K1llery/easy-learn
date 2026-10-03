declare module 'epubjs/src/packaging.js' {
  export default class Packaging {
    constructor(document: Document);
    metadata: { title: string; language: string };
    manifest: Record<string, { href: string; type: string; properties: string[] }>;
    spine: { idref: string; linear: string; index: number }[];
  }
}
declare module 'epubjs/src/container.js' {
  export default class Container {
    constructor(document: Document);
    packagePath: string;
  }
}

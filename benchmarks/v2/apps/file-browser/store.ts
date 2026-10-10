export interface FileNode {
  path: string;
  name: string;
  sizeBytes: number;
  content: string;
}

export interface DirNode {
  path: string;
  name: string;
  dirs: string[];   // child dir paths
  files: string[];  // child file paths
}

/**
 * Deep tree store. Paths are unix-style absolute strings rooted at "/".
 * All operations are path-indexed so the SLOP server can register nodes at
 * arbitrary depths without tracking parent pointers separately.
 */
export class FileBrowserStore {
  dirs = new Map<string, DirNode>();
  files = new Map<string, FileNode>();

  reset(dirs: DirNode[], files: FileNode[]) {
    this.dirs.clear();
    this.files.clear();
    for (const d of dirs) this.dirs.set(d.path, { ...d, dirs: [...d.dirs], files: [...d.files] });
    for (const f of files) this.files.set(f.path, { ...f });
  }

  getDir(path: string): DirNode | undefined {
    return this.dirs.get(path);
  }

  getFile(path: string): FileNode | undefined {
    return this.files.get(path);
  }

  listDirs(): DirNode[] {
    return Array.from(this.dirs.values());
  }

  listFiles(): FileNode[] {
    return Array.from(this.files.values());
  }

  isDirEmpty(path: string): boolean {
    const d = this.dirs.get(path);
    if (!d) return false;
    return d.dirs.length === 0 && d.files.length === 0;
  }

  deleteFile(path: string): void {
    const f = this.files.get(path);
    if (!f) throw new Error(`file ${path} not found`);
    this.files.delete(path);
    const parent = this.dirs.get(parentDir(path));
    if (parent) parent.files = parent.files.filter((p) => p !== path);
  }

  deleteDir(path: string): void {
    const d = this.dirs.get(path);
    if (!d) throw new Error(`dir ${path} not found`);
    if (!this.isDirEmpty(path)) throw new Error(`dir ${path} is not empty`);
    this.dirs.delete(path);
    const parent = this.dirs.get(parentDir(path));
    if (parent) parent.dirs = parent.dirs.filter((p) => p !== path);
  }

  renameFile(path: string, newName: string): FileNode {
    const f = this.files.get(path);
    if (!f) throw new Error(`file ${path} not found`);
    const parent = parentDir(path);
    const newPath = joinPath(parent, newName);
    if (this.files.has(newPath) || this.dirs.has(newPath)) throw new Error(`path ${newPath} already exists`);
    this.files.delete(path);
    const updated: FileNode = { ...f, path: newPath, name: newName };
    this.files.set(newPath, updated);
    const parentNode = this.dirs.get(parent);
    if (parentNode) parentNode.files = parentNode.files.map((p) => (p === path ? newPath : p));
    return updated;
  }

  moveFile(path: string, newParentPath: string): FileNode {
    const f = this.files.get(path);
    if (!f) throw new Error(`file ${path} not found`);
    const newParent = this.dirs.get(newParentPath);
    if (!newParent) throw new Error(`dir ${newParentPath} not found`);
    const oldParent = this.dirs.get(parentDir(path));
    const newPath = joinPath(newParentPath, f.name);
    if (this.files.has(newPath) || this.dirs.has(newPath)) throw new Error(`path ${newPath} already exists`);
    this.files.delete(path);
    const updated: FileNode = { ...f, path: newPath };
    this.files.set(newPath, updated);
    if (oldParent) oldParent.files = oldParent.files.filter((p) => p !== path);
    newParent.files.push(newPath);
    return updated;
  }

  createDir(parentPath: string, name: string): DirNode {
    const parent = this.dirs.get(parentPath);
    if (!parent) throw new Error(`dir ${parentPath} not found`);
    const newPath = joinPath(parentPath, name);
    if (this.dirs.has(newPath) || this.files.has(newPath)) throw new Error(`path ${newPath} already exists`);
    const d: DirNode = { path: newPath, name, dirs: [], files: [] };
    this.dirs.set(newPath, d);
    parent.dirs.push(newPath);
    return d;
  }
}

export function parentDir(path: string): string {
  if (path === "/") return "/";
  const idx = path.lastIndexOf("/");
  if (idx === 0) return "/";
  return path.slice(0, idx);
}

export function joinPath(parent: string, name: string): string {
  if (parent === "/") return `/${name}`;
  return `${parent}/${name}`;
}

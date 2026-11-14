// Minimal MDL molfile (V2000) parser for PubChem SDF records. Pure, so it is unit tested.
export type Atom = { el: string; x: number; y: number; z: number }
export type Bond = { a: number; b: number; order: number } // 0-based atom indexes

export function parseSdf(sdf: string): { atoms: Atom[]; bonds: Bond[] } {
  const lines = sdf.split(/\r?\n/)
  const counts = lines[3] ?? ''
  const nAtoms = parseInt(counts.slice(0, 3), 10)
  const nBonds = parseInt(counts.slice(3, 6), 10)
  if (!(nAtoms > 0) || !counts.includes('V2000')) throw new Error('Not a V2000 molfile')
  const atoms = lines.slice(4, 4 + nAtoms).map((l) => ({
    x: parseFloat(l.slice(0, 10)),
    y: parseFloat(l.slice(10, 20)),
    z: parseFloat(l.slice(20, 30)),
    el: l.slice(31, 34).trim(),
  }))
  const bonds = lines.slice(4 + nAtoms, 4 + nAtoms + (nBonds || 0)).map((l) => ({
    a: parseInt(l.slice(0, 3), 10) - 1,
    b: parseInt(l.slice(3, 6), 10) - 1,
    order: parseInt(l.slice(6, 9), 10),
  }))
  return { atoms, bonds }
}

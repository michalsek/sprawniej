/**
 * Who and which team a database id stands for. Rows point at people and teams by id, the screens by login and team
 * key, so every row goes through here.
 *
 * It only ever grows: a deleted guest or someone who left is still known, so their old work keeps their name. Logins
 * and team keys never change (no rule lets anyone change them), so an id keeps its name too.
 * Guest logins are unique only within one workspace (P5): clear() runs when another workspace opens and on sign-out.
 */
export class Registry {
  private loginOf = new Map<string, string>()
  private profileOf = new Map<string, string>()
  private keyOf = new Map<string, string>()
  private teamOf = new Map<string, string>()

  /** true when this id is new */
  learnProfile(id: string, login: string): boolean {
    const was = this.loginOf.get(id)
    if (was === login) return false
    if (was !== undefined) this.profileOf.delete(was)
    this.loginOf.set(id, login)
    this.profileOf.set(login, id)
    return was === undefined
  }

  /** true when this id is new */
  learnTeam(id: string, key: string): boolean {
    const was = this.keyOf.get(id)
    if (was === key) return false
    if (was !== undefined) this.teamOf.delete(was)
    this.keyOf.set(id, key)
    this.teamOf.set(key, id)
    return was === undefined
  }

  login(id: string): string | undefined {
    return this.loginOf.get(id)
  }

  profileId(login: string): string | undefined {
    return this.profileOf.get(login)
  }

  teamKey(id: string): string | undefined {
    return this.keyOf.get(id)
  }

  teamId(key: string): string | undefined {
    return this.teamOf.get(key)
  }

  /** opening another workspace, signing out */
  clear(): void {
    this.loginOf.clear()
    this.profileOf.clear()
    this.keyOf.clear()
    this.teamOf.clear()
  }
}

export const registry = new Registry()

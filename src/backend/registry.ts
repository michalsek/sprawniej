/**
 * Who and which team a database id stands for. Rows point at people and teams by id, the screens by login and team
 * key, so every row goes through here.
 *
 * It only ever grows: a deleted guest or someone who left is still known, so their old work keeps their name. Logins
 * and team keys never change (no rule lets anyone change them), so an id keeps its name too.
 * Guest logins are unique only within one workspace, so clear() runs when another workspace opens and on sign-out.
 */
export class Registry {
  /** profile id → login, and back */
  private loginOf = new Map<string, string>()
  private profileOf = new Map<string, string>()
  /** team id → team key, and back */
  private teamKeyOf = new Map<string, string>()
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
    const was = this.teamKeyOf.get(id)
    if (was === key) return false
    if (was !== undefined) this.teamOf.delete(was)
    this.teamKeyOf.set(id, key)
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
    return this.teamKeyOf.get(id)
  }

  teamId(key: string): string | undefined {
    return this.teamOf.get(key)
  }

  /** a new registry with the same ids, so the import can learn its new teams and guests without touching this one */
  copy(): Registry {
    const r = new Registry()
    for (const [id, login] of this.loginOf) r.learnProfile(id, login)
    for (const [id, key] of this.teamKeyOf) r.learnTeam(id, key)
    return r
  }

  /** opening another workspace, signing out */
  clear(): void {
    this.loginOf.clear()
    this.profileOf.clear()
    this.teamKeyOf.clear()
    this.teamOf.clear()
  }
}

export const registry = new Registry()

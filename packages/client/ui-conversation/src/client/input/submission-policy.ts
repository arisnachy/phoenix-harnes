/**
 * Composer submission policy. Plain Enter is always an interjection while the
 * addressed Agent is running and supports steering; Cmd/Ctrl+Enter is the
 * explicit "queue for later" gesture. The legacy busy-Enter preference remains
 * readable for settings/backward compatibility but no longer overrides this
 * interactive contract. Host and Agent keep the actual delivery-window authority.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@phoenix-ai/dsh-client-runtime/client'
import type {
  BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode,
} from '../contract/composer-submission.ts'
import { BUSY_ENTER_FIELD, DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts'
import type { ConversationSettings } from '../../submission-settings.ts'

export { DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts'

/**
 * Busy-Enter policy used by both the composer inject face and its Settings row.
 * Direct `steer` is the normal busy-session path: AgentLoop interrupts active
 * cooperative model/tool work, preserves the task inbox, handles the new user
 * instruction, then continues.
 */
export class ComposerSubmissionPolicy {
  /** Reactive preference source for the Settings row. */
  readonly busyEnter: SnapshotStore<BusyEnterBehavior> = createSnapshotStore(DEFAULT_BUSY_ENTER_BEHAVIOR)
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Resolve one keyboard gesture without changing state.
   * @param running - whether the addressed agent currently reports busy.
   * @param gesture - plain Enter or the Cmd/Ctrl-accelerated chord.
   * @param steeringAvailable - whether this session transport supports steering.
   * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
   */
  resolve(
    running: boolean,
    gesture: ComposerSubmitGesture,
    steeringAvailable: boolean,
  ): InputSubmitMode {
    if (!running || !steeringAvailable) return 'queue'
    // User input during active work is an interjection, never an accidental
    // next-turn queue caused by a stale persisted preference. Queue remains
    // explicit on the accelerated chord.
    return gesture === 'enter' ? 'steer' : 'queue'
  }

  /**
   * Change the plain-Enter behavior used during busy state; the live value
   * publishes before the durable write starts.
   * @param behavior - Queue or Steer.
   */
  setBusyEnter(behavior: BusyEnterBehavior): void {
    if (this.busyEnter.getSnapshot() === behavior) return
    this.busyEnter.set(behavior)
    void this.host?.set(BUSY_ENTER_FIELD, behavior)
  }

  /**
   * Adopt the scope's accepted durable behavior without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.busyEnter.getSnapshot() === section.busyEnter) return
    this.busyEnter.set(section.busyEnter)
  }
}

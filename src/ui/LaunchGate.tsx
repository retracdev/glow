import type { AccountState } from '../account/account';

// Temporary: holds visitors on a pre-launch screen. Remove this file, its styles, and its
// use in App once Glow is released.

const EARLY_ACCESS_USERNAME = 'retrac';

export function isGateOpen(account: AccountState): boolean {
  return account.status === 'authenticated' && account.username === EARLY_ACCESS_USERNAME;
}

export function LaunchGate({ account }: { account: AccountState }) {
  // Wait for the account check before showing any text, so the title never changes on screen.
  const ready = account.status !== 'unknown';
  const title =
    account.status === 'authenticated' ? `Get ready to glow, ${account.username}.` : 'Get ready to glow.';

  return (
    <div className="launch-gate">
      {ready && (
        <div className="launch-gate-card" role="dialog" aria-modal="true" aria-labelledby="launch-gate-title">
          <h1 id="launch-gate-title">{title}</h1>
          <p>
            Glow will release later this evening, around 5-8 PM. Check back soon to see if Glow is available. Not all
            features will be available on launch.
          </p>
        </div>
      )}
    </div>
  );
}

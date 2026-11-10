/*
 * Greets someone signed in to their retrac.space account, using the same pill as
 * Simple Soundboard. Guests, and any failed check, just see nothing.
 */
import { checkAccount, getAccountState, subscribeAccount, type AccountState } from './account';

const greetings = [
  (username: string) => `Hey, hey, ${username}!`,
  (username: string) => `How's it going, ${username}?`,
  (username: string) => `Time to glow, ${username}.`,
];

function showWelcomePill(username: string) {
  const pill = document.createElement('div');
  pill.className = 'welcome-pill';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  pill.setAttribute('aria-atomic', 'true');
  pill.innerHTML = `
    <img class="welcome-pill-icon" src="/retrac-space-icon.png" alt="" aria-hidden="true">
    <div class="welcome-pill-content">
      <div class="welcome-pill-brand">retrac.space</div>
      <div class="welcome-pill-message"></div>
      <div class="welcome-pill-confirmation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="m8 12 2.5 2.5L16 9"></path>
        </svg>
        <span>Logged in with your retrac.space account.</span>
      </div>
    </div>
    <span class="welcome-pill-check" aria-hidden="true">✓</span>`;
  document.body.append(pill);
  setTimeout(() => {
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    // Usernames come from the account, so they must never be treated as HTML.
    pill.querySelector('.welcome-pill-message')!.textContent = greeting(username);
    pill.classList.add('visible');
  }, 250);
  setTimeout(() => {
    pill.classList.remove('visible');
    pill.classList.add('leaving');
  }, 3400);
  setTimeout(() => pill.remove(), 3800);
}

// Greets once per page load, whenever the account turns out to be signed in.
let greeted = false;
function greet(state: AccountState) {
  if (greeted || state.status !== 'authenticated') return;
  greeted = true;
  showWelcomePill(state.username);
}

export function startAccountWelcome() {
  subscribeAccount(greet);
  greet(getAccountState());
  void checkAccount();
}

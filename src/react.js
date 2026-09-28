// Swaps the 👀 reaction #16 put on the triggering comment for the run's outcome, so the outcome
// shows up where the commenter is already looking instead of only in the Actions tab.
//
// The swap is a courtesy, like the 👀 itself: a run that already posted a Review or already
// failed must not fail *again* because the swap couldn't happen. Every failure here is caught and
// handed to `warn` instead of thrown.
/**
 * @param {{ commentId: number, reactionId: string, outcome: string, api: ReturnType<typeof import('./github.js').githubApi>, warn?: (message: string) => void }} args
 */
export async function swapReaction({ commentId, reactionId, outcome, api, warn = (message) => console.error(`::warning::${message}`) }) {
  // No 👀 went on (a stop before the write-access check, or the reaction itself failed): leave no
  // reaction at all rather than adding one now.
  if (!reactionId) return;
  const content = outcome === 'success' ? 'rocket' : 'confused';
  try {
    await api.deleteReaction(commentId, reactionId);
    await api.addReaction(commentId, content);
  } catch (err) {
    warn(`could not swap the 👀 reaction for the outcome: ${err.message}`);
  }
}

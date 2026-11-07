/** A one-line nudge. It fades out through CSS and is replaced on the next tool change. */
export function Hint({ text }: { text: string }) {
  return (
    <div className="hint" role="status">
      {text}
    </div>
  );
}

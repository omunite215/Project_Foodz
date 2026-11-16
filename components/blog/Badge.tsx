// Tag colours: dark text on the light tag background (the strong tag colours fail as text).
const STYLES = {
  Food: 'bg-tag-1-bg text-neutral-1',
  Family: 'bg-tag-3-bg text-tag-3',
  Healthy: 'bg-tag-2-bg text-neutral-1',
} as const;

const Badge = ({ type }: { type: keyof typeof STYLES }) => {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-sm px-2 py-1 text-caption ${STYLES[type]}`}
    >
      {type}
    </span>
  );
};

export default Badge;

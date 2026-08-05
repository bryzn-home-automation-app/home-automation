export function getUsageLevel(value: number) {
  if (value >= 50) {
    return {
      textClass: 'text-rose-300',
      badgeClass: 'border-rose-300/20 bg-rose-300/10 text-rose-200',
    };
  }

  if (value >= 40) {
    return {
      textClass: 'text-amber-300',
      badgeClass: 'border-amber-300/20 bg-amber-300/10 text-amber-200',
    };
  }

  if (value >= 30) {
    return {
      textClass: 'text-yellow-300',
      badgeClass: 'border-yellow-300/20 bg-yellow-300/10 text-yellow-200',
    };
  }

  return {
    textClass: 'text-emerald-300',
    badgeClass: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200',
  };
}
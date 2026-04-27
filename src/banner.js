import pc from 'picocolors';

const ART = String.raw`
 ____  ___ ____  ____   ____
|  _ \|_ _/ ___|/ ___| / ___|
| | | || |\___ \\___ \| |
| |_| || | ___) |___) | |___
|____/|___|____/|____/ \____|
`;

const SUBTITLE = 'Data-Intensive Social Science Center at Yale';

export function printBanner() {
  if (process.env.NO_BANNER) return;
  const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
  const lines = ART.split('\n').slice(1, -1);
  const colored = useColor ? lines.map((l) => pc.blue(pc.bold(l))) : lines;
  const sub = useColor ? pc.dim(SUBTITLE) : SUBTITLE;
  console.log(colored.join('\n'));
  console.log(sub);
  console.log();
}

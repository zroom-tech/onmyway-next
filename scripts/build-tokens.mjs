// design-tokens/tokens.json → 웹용 CSS 변수 + 앱용 Dart 상수를 생성한다.
// 사용법: node scripts/build-tokens.mjs [--dart <출력 경로>]
// --dart를 생략하면 같은 상위 폴더의 onmyway-app이 있을 때 그쪽에 쓴다.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(resolve(root, "design-tokens/tokens.json"), "utf8"));

const HEADER = "생성 파일 — 직접 수정하지 말 것. onmyway-next/design-tokens/tokens.json 수정 후 `npm run tokens`";

// { color: { brand: { primary: {$value} } } } → [["color","brand","primary"], token]
function flatten(node, path = []) {
  if (node && typeof node === "object" && "$value" in node) return [[path, node]];
  return Object.entries(node)
    .filter(([key]) => !key.startsWith("$"))
    .flatMap(([key, child]) => flatten(child, [...path, key]));
}

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const camel = (parts) =>
  parts.map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join("");

const entries = flatten(tokens);

// ---- CSS ----
// 값은 --omw-* 에 두고, Tailwind 유틸리티(bg-brand-primary, rounded-md 등)는 @theme inline 으로 연결한다.
const css = [`/* ${HEADER} */`, ":root {"];
const theme = ["@theme inline {"];
for (const [path, token] of entries) {
  const name = path.map(kebab).join("-");
  if (token.$type === "color") {
    css.push(`  --omw-${name}: ${token.$value};`);
    theme.push(`  --${name}: var(--omw-${name});`);
  } else if (token.$type === "dimension") {
    css.push(`  --omw-${name}: ${token.$value}px;`);
    if (path[0] === "radius") theme.push(`  --${name}: var(--omw-${name});`);
  } else if (token.$type === "typography") {
    const { fontSize, lineHeight, fontWeight, letterSpacing = 0 } = token.$value;
    css.push(`  --omw-${name}-size: ${fontSize}px;`);
    css.push(`  --omw-${name}-line-height: ${lineHeight}px;`);
    css.push(`  --omw-${name}-weight: ${fontWeight};`);
    css.push(`  --omw-${name}-letter-spacing: ${letterSpacing}px;`);
    theme.push(`  --text-${path[1]}: var(--omw-${name}-size);`);
    theme.push(`  --text-${path[1]}--line-height: var(--omw-${name}-line-height);`);
    theme.push(`  --text-${path[1]}--font-weight: var(--omw-${name}-weight);`);
    theme.push(`  --text-${path[1]}--letter-spacing: var(--omw-${name}-letter-spacing);`);
  }
}
css.push("}", "", ...theme, "}", "");
writeFileSync(resolve(root, "src/styles/tokens.css"), css.join("\n"));
console.log("✓ src/styles/tokens.css");

// ---- Dart ----
const dartArg = process.argv.indexOf("--dart");
const dartOut =
  dartArg > -1
    ? resolve(process.argv[dartArg + 1])
    : resolve(root, "../onmyway-app/lib/core/theme/tokens.g.dart");

if (dartArg === -1 && !existsSync(resolve(root, "../onmyway-app"))) {
  console.log("- onmyway-app 없음: Dart 생성 건너뜀");
} else {
  const dart = [`// ${HEADER}`, "", "import 'package:flutter/painting.dart';", ""];
  const groups = { color: "TokenColors", type: "TokenTypography", space: "TokenSpace", radius: "TokenRadius", stroke: "TokenStroke" };
  for (const [group, className] of Object.entries(groups)) {
    dart.push(`abstract final class ${className} {`);
    for (const [path, token] of entries.filter(([p]) => p[0] === group)) {
      const name = camel(path.slice(1).map((p) => (/^\d/.test(p) ? `s${p}` : p)));
      if (token.$type === "color") {
        dart.push(`  static const ${name} = Color(0xFF${token.$value.slice(1).toUpperCase()});`);
      } else if (token.$type === "dimension") {
        dart.push(`  static const double ${name} = ${token.$value};`);
      } else if (token.$type === "typography") {
        const { fontSize, lineHeight, fontWeight, letterSpacing = 0 } = token.$value;
        dart.push(
          `  static const ${name} = TextStyle(fontSize: ${fontSize}, height: ${(lineHeight / fontSize).toFixed(4)}, fontWeight: FontWeight.w${fontWeight}, letterSpacing: ${letterSpacing});`,
        );
      }
    }
    dart.push("}", "");
  }
  writeFileSync(dartOut, dart.join("\n"));
  // 앱 저장소의 dart format 결과와 같게 맞춘다. 안 맞추면 재생성할 때마다 diff가 생긴다.
  try {
    execFileSync("dart", ["format", dartOut], { stdio: "ignore" });
  } catch {
    console.log("- dart 없음: Dart 파일 포맷 건너뜀 (앱 저장소에서 dart format 실행 필요)");
  }
  console.log(`✓ ${dartOut}`);
}

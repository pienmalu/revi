import { Fragment } from "react";
import { jaModel, Parser } from "budoux";

const parser = new Parser(jaModel);

/**
 * 固定の説明文を、文節の切れ目でだけ改行させる（「使えな / くなります」のような切れ方を防ぐ）。
 * Chrome は CSS の word-break: auto-phrase でもできるが Safari ではできないので、
 * BudouX で文節に分けて <wbr> を入れ、keep-all で包む。文中の \n は改行にする。
 */
export function Jp({ children }: { children: string }) {
  return (
    <span className="jp">
      {children.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {parser.parse(line).map((phrase, j) => (
            <Fragment key={j}>
              {j > 0 && <wbr />}
              {phrase}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

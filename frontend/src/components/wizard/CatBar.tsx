import { useState } from "react";
import { fa } from "../../fmt";

/* Torob's own top row of categories. The dataset has no top level, only leaf categories, so each one opens, in
   place, the leaves of the dataset that belong under it (names and product counts from its categories table);
   with Torob's real catalogue the same row would list its real subcategories. */
const CATS: [string, [string, number][]][] = [
  ["موبایل و کالای دیجیتال", [["گوشی موبایل", 814], ["هدفون، هدست و هندزفری", 1339], ["ساعت و مچ بند هوشمند", 462], ["پاوربانک و شارژر همراه", 755]]],
  ["لپ‌تاپ، کامپیوتر، اداری", [["لپ تاپ و نوت بوک", 505], ["هارد دیسک اینترنال", 471], ["ماوس", 226], ["پرینتر لیزری و چند کاره", 164]]],
  ["هایپر مارکت", [["قهوه", 166], ["شکلات، تافی و آبنبات", 43], ["غذا و تشویقی سگ و گربه", 490]]],
  ["لوازم خانگی", [["یخچال فریزر ساید بای ساید", 103], ["ماشین لباسشویی", 90], ["جارو برقی", 123], ["چای ساز", 60]]],
  ["مد و پوشاک", [["کتانی و کفش اسپرت", 865], ["پیراهن مردانه", 787], ["عینک آفتابی", 1043], ["کیف و کوله", 928]]],
  ["زیبایی و بهداشت", [["عطر و ادکلن", 1154], ["ماشین اصلاح و ریش‌تراش", 528], ["سشوار و برس حرارتی", 277], ["شامپو و نرم کننده", 121]]],
  ["صوتی و تصویری", [["تلویزیون", 358], ["اسپیکر و سیستم صوتی", 1063], ["میکروفون", 731], ["دستگاه ویدیو پروژکتور", 332]]],
  ["خودرو و سایر وسایل نقلیه", [["لنت ترمز خودرو", 635], ["ساب و بلندگو خودرو", 618], ["چراغ جلو خودرو", 379], ["فیلتر روغن خودرو", 114]]],
  ["سلامت و پزشکی", [["فشارسنج پزشکی", 346], ["ماساژور و لوازم ماساژ", 594], ["اکسیژن ساز و نبولایزر", 236], ["دماسنج و رطوبت سنج", 237]]],
  ["فرهنگی هنری", [["کتاب چاپی", 555], ["گیتار", 183], ["دیسک بازی پلی استیشن", 301]]],
  ["ورزش و تناسب اندام", [["تردمیل", 99], ["دوچرخه ثابت و الپتیکال", 142], ["دوربین ورزشی", 133], ["کیف و کوله ورزشی", 41]]],
  ["سایر دسته‌ها", [["دوربین مدار بسته", 3467], ["چراغ پنلی و سقفی", 2370], ["ژنراتور و موتور برق", 1790], ["دریل و پیچ گوشتی برقی و شارژی", 391]]],
];

/** The categories row under the hero: it scrolls sideways, and a tapped one opens its leaves under it. */
export function CatBar({ onPick }: { onPick: (text: string) => void }) {
  const [on, setOn] = useState<number | null>(null);
  return (
    <div className="wz-cats fadein">
      <div className="wz-cats-row" role="toolbar" aria-label="دسته‌بندی‌ها">
        {CATS.map(([name], k) => (
          <button key={name} className={"wz-cat" + (on === k ? " on" : "")} aria-expanded={on === k} onClick={() => setOn(on === k ? null : k)}>
            {name}
          </button>
        ))}
      </div>
      {on !== null && (
        <div className="wz-cat-open" key={on}>
          {CATS[on][1].map(([leaf, n]) => (
            <button key={leaf} className="wz-leaf" onClick={() => onPick(leaf)}>
              <b>{leaf}</b><small>{fa(n)} کالا</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

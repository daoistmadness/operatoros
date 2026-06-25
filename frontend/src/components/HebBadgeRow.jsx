import React from "react";
import { BookOpen } from "lucide-react";

export function HebBadgeRow({ hebByJenjang }) {
  if (!hebByJenjang || Object.keys(hebByJenjang).length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {Object.entries(hebByJenjang).map(([jenjang, heb]) => (
        <span
          key={jenjang}
          className="inline-flex items-center gap-1.5 rounded-[9999px] bg-emerald-100 text-emerald-800 px-3 py-1 text-xs font-semibold"
        >
          <BookOpen size={12} />
          {jenjang}: <strong>{heb}</strong> HEB
        </span>
      ))}
    </div>
  );
}

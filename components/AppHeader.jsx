"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const currentTool = pathname?.startsWith("/excalidraw") ? "excalidraw" : "drawio";

  const handleLogoClick = () => {
    router.push("/");
  };

  return (
    <header className="flex items-center justify-start gap-4 px-4 py-3 bg-transparent backdrop-blur-sm z-10">
      <div className="flex items-center gap-4 h-[40px]">
        <img
          src="/logo.png"
          alt="Smart Diagram"
          className="h-full w-auto select-none cursor-pointer hover:opacity-80 transition-opacity"
          onClick={handleLogoClick}
        />
        <Select value={currentTool} onValueChange={(value) => router.push(`/${value}`)}>
          <SelectTrigger className="w-[150px] border-none bg-transparent shadow-none hover:bg-transparent focus:ring-0 focus:ring-offset-0">
            <SelectValue placeholder="选择编辑器" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="drawio">Draw.io</SelectItem>
            <SelectItem value="excalidraw">Excalidraw</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}

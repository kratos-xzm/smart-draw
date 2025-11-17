"use client";

import { useRouter } from "next/navigation";

export default function AppHeader() {
  const router = useRouter();

  const handleLogoClick = () => {
    router.push("/");
  };

  return (
    <header className="flex items-center justify-start gap-4 px-4 py-3 bg-transparent backdrop-blur-sm z-10">
      <div className="flex items-center gap-3 h-[40px]">
        <img
          src="/logo.png"
          alt="Smart Diagram"
          className="h-full w-auto select-none cursor-pointer hover:opacity-80 transition-opacity"
          onClick={handleLogoClick}
        />
        {/* <h1 className="text-xl font-semibold text-gray-800 select-none">Smart Diagram</h1> */}
      </div>
    </header>
  );
}

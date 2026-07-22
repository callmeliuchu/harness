import type { Metadata } from "next";
import en from "@/i18n/messages/en.json";
import ja from "@/i18n/messages/ja.json";
import zh from "@/i18n/messages/zh.json";

const messagesByLocale = { en, zh, ja };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = messagesByLocale[locale as keyof typeof messagesByLocale] ?? en;
  return {
    title: "ParoClaw",
    description: messages.paro.subtitle,
  };
}

export default function ParoLayout({ children }: { children: React.ReactNode }) {
  return children;
}

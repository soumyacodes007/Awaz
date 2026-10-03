import { ApiSection } from "@/components/landing/ApiSection";
import { Enablers } from "@/components/landing/Enablers";
import { Hero } from "@/components/landing/Hero";
import { Industries } from "@/components/landing/Industries";
import { PlatformShowcase } from "@/components/landing/PlatformShowcase";
import { SelfHosted } from "@/components/landing/SelfHosted";
import { VoiceLibrary } from "@/components/landing/VoiceLibrary";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <PlatformShowcase />
      <VoiceLibrary />
      <ApiSection />
      <Industries />
      <Enablers />
      <SelfHosted />
    </>
  );
}

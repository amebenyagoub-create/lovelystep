import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = {
  title: "Politique de confidentialité | Lovely Step",
  description: "Les données collectées par Lovely Step, leur usage, leur durée de conservation et vos droits.",
};

export default function Page() {
  return <LegalPage kind="privacy" />;
}

import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = {
  title: "Suppression de vos données | Lovely Step",
  description: "Comment demander la suppression de vos données personnelles chez Lovely Step, et ce qui est effacé.",
};

export default function Page() {
  return <LegalPage kind="deletion" />;
}

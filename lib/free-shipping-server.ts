import "server-only";
import { parseFreeShippingThresholdDzd } from "@/lib/free-shipping";

export function getFreeShippingThresholdCents() {
  return parseFreeShippingThresholdDzd(process.env.FREE_SHIPPING_THRESHOLD_DZD);
}

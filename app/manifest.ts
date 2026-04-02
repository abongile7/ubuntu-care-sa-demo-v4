import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UbuntuCare SA Demo",
    short_name: "UbuntuCare",
    description: "Paperless South African hospital demo for phones and laptops.",
    start_url: "/login",
    display: "standalone",
    background_color: "#eef5ff",
    theme_color: "#0f6dcb"
  };
}

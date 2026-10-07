import { CartProvider } from "@/components/customer/cart";
import { Header, Footer } from "@/components/customer/shell";
import { PublicTheme } from "@/components/customer/theme";
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CartProvider>
      <PublicTheme>
        <Header />
        <main id="main" className="site-main" tabIndex={-1}>
          {children}
        </main>
        <Footer />
      </PublicTheme>
    </CartProvider>
  );
}

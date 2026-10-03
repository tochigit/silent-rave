import { CartProvider } from "@/components/customer/cart";
import { Header, Footer } from "@/components/customer/shell";
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CartProvider>
      <div className="public-site">
        <Header />
        <main id="main" className="site-main" tabIndex={-1}>
          {children}
        </main>
        <Footer />
      </div>
    </CartProvider>
  );
}

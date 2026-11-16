import { notFound } from 'next/navigation';
import ProductPage from '@/components/menu/ProductPage';
import { koreanMenu } from '@/constants';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = koreanMenu.find((entry) => entry.id === id);
  if (!item) notFound();

  return (
    <ProductPage
      title={item.title}
      imgSrc={item.imgSrc}
      price={item.price}
      description={item.description}
    />
  );
}

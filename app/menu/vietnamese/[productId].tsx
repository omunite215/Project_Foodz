import { useRouter } from "next/router"
import ProductPage from "@/components/menu/ProductPage"
import { ThaiMenu } from "@/constants"

const page = () => {
  const router  = useRouter();
  let desiredItem = router.query.productId;
  let specificObject = ThaiMenu.find(obj => obj.id === desiredItem);
  return (
    <div>
      <ProductPage title={specificObject?.title} imgSrc={specificObject?.imgSrc} price={specificObject?.price} description={specificObject?.description} />
    </div>
  )
}

export default page;
import ProductPage from "@/components/menu/ProductPage"
import { ThaiMenu } from "@/constants"

const page = ({params}: {params: { id: string}}) => {
  let desiredItem = params.id;
  let specificObject = ThaiMenu.find(obj => obj.id === desiredItem);
  return (
    <div>
      <ProductPage title={specificObject?.title} imgSrc={specificObject?.imgSrc} price={specificObject?.price} description={specificObject?.description} />
    </div>
  )
}

export default page;
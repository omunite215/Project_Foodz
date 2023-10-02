import ProductPage from "@/components/menu/ProductPage"
import { koreanMenu } from "@/constants"
import { redirect } from "next/navigation";

const page = async ({params}: {params: { id: string}}) => {
  let desiredItem = params.id;
  let specificObject = koreanMenu.find(obj => obj.id === desiredItem);
  if(!specificObject) redirect('/');
  return (
    <div>
      <ProductPage title={specificObject.title} imgSrc={specificObject.imgSrc} price={specificObject.price} description={specificObject.description} />
    </div>
  )
}

export default page;
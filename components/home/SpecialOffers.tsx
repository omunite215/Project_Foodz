import FoodCard from "../common/FoodCard"
import { foodCardContent } from "@/constants"

const SpecialOffers = () => {
  return (
    <section className='w-full flex flex-col justify-center items-center'>
        <div className='flex flex-col gap-3 text-center justify-center items-center'>
            <h1 className=' font-alice font-normal text-5xl text-textBlack'>Today <span className='text-primaryGreen'>Special</span> Offers</h1>
            <p className=' font-poppins font-normal text-2xl text-textNeutralBlack w-3/4'>Best cooks and bext delivery guys all at your service. Hot tasty food will reach you in 60 minutes.</p>
        </div>
        <div className="w-full flex justify-between items-center py-20">
          {foodCardContent.map((item,index) => (
            <div key={item.title}>
              <FoodCard title={item.title} imageSrc={item.imageSrc} price={item.price} show={index===1 ? true : false} content={item.content} />
            </div>
          ))}

        </div>

    </section>
  )
}

export default SpecialOffers
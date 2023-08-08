import HowToCard from "../common/HowToCard"
import { howWeKeepContent } from "@/constants"

const HowWeKeep = () => {
  return (
    <section className='w-full flex flex-col justify-center items-center gap-[6.69rem] py-14'>
        <h1 className=" font-alice text-5xl font-normal leading-normal capitalize text-textBlack">How we keep your meal <span className=" text-primaryGreen">Delicious</span></h1>
        <div className=" w-full flex justify-between items-center">
            {howWeKeepContent.map((card,index)=>(
                <div key={card.title}>
                    <HowToCard imageSrc={card.imageSrc} title={card.title} description={card.description} bg={index === 1 ? true : false} />
                </div>
            ))}

        </div>
    </section>
  )
}

export default HowWeKeep
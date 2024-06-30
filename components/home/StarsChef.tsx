import Link from "next/link"
import Image from "next/image"

const StarsChef = () => {
  return (
    <section className="w-full flexCenter flex-col md:py-14 sm:py-20 py-10 sm:gap-20 gap-8 padding-x">
    <h2 className="component-title-text">
      19 <span className="component-title-highlight-text">Michelin</span> Stars Chef
    </h2>
    <div className="flexBetween md:flex-row flex-col w-full">
      <Image
        src="/Home/StarChef/starChef.svg"
        width={451}
        height={396}
        alt="StarChef"
        className="md:w-[31.3125rem] w-[21.9375rem] md:h-[27.875rem] h-[19.5625rem] sm:block hidden"
      />
      <div className="flex flex-col gap-3 max-w-[38.375rem]">
        <div className="flexBetween flex-1 md:text-2xl sm:text-lg text-base">
          <h4 className="text-primaryGreen font-alice">Alain Ducasse &#8210; 19 Michelin Stars</h4>
          <Link
            href="/contact"
            className=" sm:block hidden star-chef-link"
          >
            <h4>View All Restaurant &#8594;</h4>
          </Link>
        </div>
        <ul className="space-y-5 md:text-lg text-base font-poppins list-none text-paraTextColor">
          <li>
            Considered by many to be one of the best chefs in the world&#44;
            he&#39;s built a business empire over the years with 36
            restaurants spanning across the globe. He&#39;s also one of only
            two chefs to hold 21 Michelin stars throughout his career and the
            first chef to own restaurants carrying three Michelin Stars in
            three cities.
          </li>
          <li>
            In addition to being known for world-class French cuisine&#44;
            Ducasse is the only chef on this list who has sent his food into
            space. In 2015&#44; Ducasse sent meals to astronauts orbiting
            Earth aboard the International Space Station&#44; an
            accomplishment that Ducasse said he viewed as conquering &#8216;
            the final frontier &#40;of cooking&#41;&#8217;.
          </li>
          <li>
            <Link
              href="/contact"
              className="sm:hidden block star-chef-link"
            >
              <h4>View All Restaurant &#8594;</h4>
            </Link>
          </li>
        </ul>
      </div>
    </div>
  </section>
  )
}

export default StarsChef
import Link from "next/link";
import Image from "next/image";

const StarChef = () => {
  return (
    <section className="w-full flex flex-col justify-center items-center py-14 gap-20">
      <h2 className=" font-alice text-5xl font-normal capitalize text-textBlack">
        19 <span className=" text-primaryGreen">Michelin</span> Stars Chef
      </h2>
      <div className=" flex flex-1 justify-between items-center gap-28">
        <Image
          src="../../starChef.svg"
          width={451}
          height={396}
          alt="StarChef"
        />
        <div className=" flex flex-1 flex-col justify-center gap-3 font-normal">
          <div className=" flex flex-1 justify-between items-center font-alice text-2xl text-primaryGreen">
            <h4>Alain Ducasse &#8210; 19 Michelin Stars</h4>
            <Link href="/contact">
              <h4>View All Restaurant &#8594;</h4>
            </Link>
          </div>
          <ul className=" flex flex-col text-xl font-poppins gap-5 list-none text-paraTextColor">
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
          </ul>
        </div>
      </div>
    </section>
  );
};

export default StarChef;

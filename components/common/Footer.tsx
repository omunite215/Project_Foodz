import Image from "next/image";
import { footerLinks } from "@/constants";
const Footer = () => (
  <footer className="w-full">
    <section
      className="flex justify-center items-center px-6 pt-[3.81rem] pb-[4.88rem] sm:px-16 max-w-[1440px] mx-auto flex-col"
    >
      <div className="flex justify-center items-center md:flex-row flex-col mb-8 w-full gap-14">
        <div className="flex justify-center items-center flex-col  mr-10">
          <Image
            src="../../logo.svg"
            alt="TX"
            width={140}
            height={40}
            className="object-contain"
          />
          <p className="font-poppins text-textNeutralBlack font-normal text-[18px] leading-[30.8px] mt-4 max-w-[312px] text-center">
          Explore your Taste with speacial food in the special place, that will make you happy. I try to write some thing without lorem isum.
          </p>
        </div>

        <div className="flex-[1.5] w-full flex flex-row justify-between flex-wrap md:mt-0 mt-10 pl-10">
          {footerLinks.map((footerlink) => (
            <div
              key={footerlink.title}
              className={`flex flex-col ss:my-0 my-4 min-w-[150px]`}
            >
              <h4 className="font-poppins font-semibold text-xl">
                {footerlink.title}
              </h4>
              <ul className="list-none mt-4">
                {footerlink.links.map((link, index) => (
                  <li
                    key={link.name}
                    className={`font-poppins font-medium text-[16px] text-textNeutralBlack hover:text-textBlack leading-[24px] cursor-pointer ${
                      index !== footerlink.links.length - 1 ? "mb-4" : "mb-0"
                    }`}
                  >
                    {link.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  </footer>
);

export default Footer;
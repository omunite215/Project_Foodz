import Image from "next/image";

interface DeliciousCardProps {
  imageSrc: string;
  title: string;
  description: string;
}

const DeliciousCard = ({
  imageSrc,
  title,
  description,
}: DeliciousCardProps) => {
  return (
    <div
      className={`flexCenter flex-col gap-6 max-w-[24.063rem] min-w-[18.5rem] px-6 py-7 rounded-xl ${
        title === "Prepare Your Meal" ? "bg-white shadow-lg" : "bg-transparent"
      }`}
    >
      <div className="bg-white rounded-full py-9 px-9 shadow-xl">
        <Image
          src={imageSrc}
          width={48}
          height={48}
          alt={title}
          className="delicious-card-img"
        />
      </div>
      <div className=" flexCenter flex-col gap-[0.375rem]">
        <h1 className="delicious-card-title-text">{title}</h1>
        <p className="delicious-card-sub-title-text">{description}</p>
      </div>
    </div>
  );
};

export default DeliciousCard;

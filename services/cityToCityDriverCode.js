function formatCityToCityDriverCode(value) {
    const id=Number(value);
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('Invalid city-to-city driver ID');
    return `CTC_${String(id).padStart(4,'0')}`;
}
module.exports={formatCityToCityDriverCode};

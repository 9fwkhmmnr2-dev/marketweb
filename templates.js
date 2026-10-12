/* Catálogo de plantillas de MarketWeb. Para sumar una, agregá un objeto siguiendo estos ejemplos.
   ready:true permite abrir el editor genérico; ready:false la muestra como próximamente. */
window.MARKETWEB_TEMPLATES = [
  { name:"Barbería", cat:"Servicios", desc:"Servicios, precios, horarios y turnos por WhatsApp.", c:["#f8f5f0","#b88a55","#202938"], tags:["Clásica","Turnos"], keys:"beige dorado peluqueria whatsapp horarios precios", ready:true },
  { name:"Restaurante", cat:"Gastronomía", desc:"Carta, fotos, horarios y botón para reservar.", c:["#fff7ed","#c2410c","#3b1d0e"], tags:["Cálida","Reservas"], keys:"naranja carta menu comida", ready:false },
  { name:"Cafetería", cat:"Gastronomía", desc:"Menú del día, ubicación y redes sociales.", c:["#f5efe6","#7c5a3a","#2b1d12"], tags:["Cálida","Minimalista"], keys:"marron cafe menu", ready:false },
  { name:"Tienda", cat:"Comercio", desc:"Catálogo de productos con consulta por WhatsApp.", c:["#f3f8ff","#2563eb","#10213f"], tags:["Moderna","Tienda"], keys:"azul vender productos catalogo ropa", ready:false },
  { name:"Profesional", cat:"Servicios", desc:"Presentación, servicios y formulario de contacto.", c:["#f4fbf8","#0f766e","#0b2b27"], tags:["Minimalista","Turnos"], keys:"verde consultorio abogado contador servicios", ready:false },
  { name:"Portfolio", cat:"Personal", desc:"Proyectos, sobre mí y contacto.", c:["#fafafa","#7c3aed","#1e1033"], tags:["Minimalista","Creativa"], keys:"violeta proyectos curriculum cv", ready:false },
  { name:"Agenda de turnos", cat:"Agendas", desc:"Página para que tus clientes pidan turno.", c:["#fff8f1","#ea580c","#2a160b"], tags:["Moderna","Turnos"], keys:"naranja citas reservas", ready:false },
  { name:"Gimnasio", cat:"Servicios", desc:"Planes, horarios de clases y contacto.", c:["#16181d","#dc2626","#f6f7f9"], tags:["Oscura","Deportiva"], keys:"rojo negro clases planes deportes", ready:false }
].map(t => ({ price: 0.9, ...t }));

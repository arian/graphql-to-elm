module OtherTypeOtherFields exposing (Data, Dog, Person, Person2, Person3, decoder, query)

import Json.Decode


query : String
query =
    """{
  i {
    dog {
      name
    }
  }
  me {
    name
  }
  you {
    email
  }
}"""


type alias Dog =
    { name : Maybe String
    }


dogDecoder : Json.Decode.Decoder Dog
dogDecoder =
    Json.Decode.map Dog
        (Json.Decode.field "name" (Json.Decode.nullable Json.Decode.string))


type alias Person2 =
    { email : Maybe String
    }


person2Decoder : Json.Decode.Decoder Person2
person2Decoder =
    Json.Decode.map Person2
        (Json.Decode.field "email" (Json.Decode.nullable Json.Decode.string))


type alias Person =
    { name : String
    }


personDecoder : Json.Decode.Decoder Person
personDecoder =
    Json.Decode.map Person
        (Json.Decode.field "name" Json.Decode.string)


type alias Person3 =
    { dog : Maybe Dog
    }


person3Decoder : Json.Decode.Decoder Person3
person3Decoder =
    Json.Decode.map Person3
        (Json.Decode.field "dog" (Json.Decode.nullable dogDecoder))


type alias Data =
    { i : Person3
    , me : Person
    , you : Person2
    }


decoder : Json.Decode.Decoder Data
decoder =
    Json.Decode.map3 Data
        (Json.Decode.field "i" person3Decoder)
        (Json.Decode.field "me" personDecoder)
        (Json.Decode.field "you" person2Decoder)